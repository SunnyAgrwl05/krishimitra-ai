"""
app.py
-------
KrishiMitra backend. Ek Flask app jo pura AI pipeline serve karta hai:
  ingestion (simulated satellite) -> feature extraction -> AI models
  (crop + stress) -> decision engine (irrigation advisory) -> dashboard.

Run: python3 app.py   (default: http://0.0.0.0:5000)
"""

import os
import sys
import json
from datetime import date, datetime

from flask import Flask, jsonify, request, render_template

sys.path.append(os.path.join(os.path.dirname(__file__), "model"))
from satellite_sim import simulate_field, CROP_CALENDAR
from decision_engine import compute_advisory
from weather import get_weather
from location_search import search_location
import history as history_db

import joblib
import pandas as pd

BASE = os.path.dirname(__file__)
MODEL_DIR = os.path.join(BASE, "model")
FEATURES = ["NDVI", "NDWI", "MSI", "VV_dB", "VH_dB", "VV_VH_ratio", "growth_fraction"]

app = Flask(__name__)

app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True

history_db.init_db()

_crop_model = None
_stress_model = None


def get_models():
    global _crop_model, _stress_model
    if _crop_model is None:
        crop_path = os.path.join(MODEL_DIR, "crop_model.pkl")
        stress_path = os.path.join(MODEL_DIR, "stress_model.pkl")
        if not (os.path.exists(crop_path) and os.path.exists(stress_path)):
            raise RuntimeError(
                "Models not found. Run: python3 model/generate_training_data.py "
                "&& python3 model/train_model.py"
            )
        _crop_model = joblib.load(crop_path)
        _stress_model = joblib.load(stress_path)
    return _crop_model, _stress_model


# ---- demo fields shown on the dashboard by default (matches the mock UI) ----
DEMO_FIELDS = [
    {"id": "F-21", "name": "Chhotelal", "district": "Budaun", "state": "UP", "lat": 27.9, "lon": 79.13, "crop_hint": "Wheat"},
    {"id": "F-14", "name": "Nand Kishor", "district": "Unnao", "state": "UP", "lat": 26.53, "lon": 80.49, "crop_hint": "Rice"},
    {"id": "F-08", "name": "Badrinath", "district": "Sitapur", "state": "UP", "lat": 27.57, "lon": 80.68, "crop_hint": "Maize"},
    {"id": "F-33", "name": "Kamlesh Kumar", "district": "Shahjahanpur", "state": "UP", "lat": 27.88, "lon": 79.91, "crop_hint": "Pulses"},
    {"id": "F-05", "name": "Suresh Singh", "district": "Bareilly", "state": "UP", "lat": 28.35, "lon": 79.43, "crop_hint": "Maize"},
    {"id": "F-19", "name": "Dindayal", "district": "Lakhimpur", "state": "UP", "lat": 27.95, "lon": 80.78, "crop_hint": "Rice"},
]


def run_pipeline(lat, lon, crop_hint=None, when=None, deficit=None):
    """Full pipeline: ingestion -> features -> AI models -> decision engine."""
    rec = simulate_field(lat, lon, crop_hint=crop_hint, when=when, irrigation_deficit_pct=deficit)

    crop_model, stress_model = get_models()
    feat = pd.DataFrame([{
        "NDVI": rec["optical"]["NDVI"], "NDWI": rec["optical"]["NDWI"], "MSI": rec["optical"]["MSI"],
        "VV_dB": rec["sar"]["VV_dB"], "VH_dB": rec["sar"]["VH_dB"],
        "VV_VH_ratio": rec["sar"]["VV_VH_ratio"], "growth_fraction": rec["growth_fraction"],
    }])[FEATURES]

    predicted_crop = crop_model.predict(feat)[0]
    crop_proba = max(crop_model.predict_proba(feat)[0])
    predicted_stress = stress_model.predict(feat)[0]
    stress_proba = max(stress_model.predict_proba(feat)[0])

    advisory = compute_advisory(rec, predicted_stress)

    return {
        "field": {"lat": lat, "lon": lon, "date": rec["date"]},
        "satellite_features": rec,
        "ai_prediction": {
            "predicted_crop": predicted_crop,
            "crop_confidence": round(float(crop_proba), 3),
            "predicted_stress": predicted_stress,
            "stress_confidence": round(float(stress_proba), 3),
        },
        "advisory": advisory,
    }


@app.route("/")
def dashboard():
    return render_template("index.html")


@app.route("/api/fields")
def api_fields():
    """Runs the full pipeline for all demo fields (as shown on the map)."""
    results = []
    for f in DEMO_FIELDS:
        try:
            out = run_pipeline(f["lat"], f["lon"], crop_hint=f["crop_hint"])
            out["field"].update({"id": f["id"], "name": f["name"], "district": f["district"], "state": f["state"]})
            results.append(out)
        except Exception as e:
            results.append({"error": str(e), "field": f})
    return jsonify(results)


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    """Ad-hoc analysis for a user-supplied lat/lon (+ optional crop hint / date)."""
    data = request.get_json(force=True) or {}
    try:
        lat = float(data["lat"])
        lon = float(data["lon"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "lat aur lon (numbers) required hain"}), 400

    crop_hint = data.get("crop") or None
    if crop_hint not in (None, *CROP_CALENDAR.keys()):
        crop_hint = None

    when = None
    if data.get("date"):
        try:
            when = datetime.strptime(data["date"], "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "date format YYYY-MM-DD hona chahiye"}), 400

    deficit = data.get("deficit_pct")
    if deficit is not None:
        try:
            deficit = float(deficit)
        except ValueError:
            return jsonify({"error": "deficit_pct number hona chahiye"}), 400

    result = run_pipeline(lat, lon, crop_hint=crop_hint, when=when, deficit=deficit)
    try:
        history_db.log_analysis(result)
    except Exception as e:
        print(f"[app.py] History log failed (non-fatal): {e}")
    return jsonify(result)


@app.route("/api/model-metrics")
def api_metrics():
    metrics_path = os.path.join(MODEL_DIR, "metrics.json")
    if not os.path.exists(metrics_path):
        return jsonify({"error": "metrics.json missing, train model first"}), 404
    with open(metrics_path) as f:
        return jsonify(json.load(f))


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "time": datetime.now().isoformat()})


@app.route("/api/weather")
def api_weather():
    """Rain/humidity/temp/wind for a lat/lon -- live OpenWeatherMap if OPENWEATHER_API_KEY
    is set, otherwise a deterministic simulated forecast (never errors out)."""
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat aur lon query params (numbers) required hain"}), 400
    return jsonify(get_weather(lat, lon))


@app.route("/api/search-location")
def api_search_location():
    """Village/district/state autocomplete via Nominatim. Always returns 200 --
    an empty results list (with a note) if the lookup can't complete."""
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"results": [], "note": "q query param required hai"}), 400
    return jsonify(search_location(query))


@app.route("/api/history")
def api_history():
    """Past analyses logged by /api/analyze. Supports ?crop=&urgency=&limit="""
    limit = request.args.get("limit", 50)
    try:
        limit = int(limit)
    except ValueError:
        limit = 50
    crop = request.args.get("crop") or None
    urgency = request.args.get("urgency") or None
    try:
        return jsonify(history_db.get_history(limit=limit, crop=crop, urgency=urgency))
    except Exception as e:
        return jsonify({"error": f"History fetch failed: {e}"}), 500


@app.route("/api/dashboard")
def api_dashboard():
    """Aggregate summary across the demo fields -- for a landing/overview widget."""
    try:
        results = []
        for f in DEMO_FIELDS:
            try:
                out = run_pipeline(f["lat"], f["lon"], crop_hint=f["crop_hint"])
                results.append(out)
            except Exception:
                continue

        total = len(results)
        crop_counts, stress_counts, urgency_counts = {}, {}, {}
        avg_ndvi = 0.0
        for r in results:
            crop_counts[r["ai_prediction"]["predicted_crop"]] = crop_counts.get(r["ai_prediction"]["predicted_crop"], 0) + 1
            stress_counts[r["ai_prediction"]["predicted_stress"]] = stress_counts.get(r["ai_prediction"]["predicted_stress"], 0) + 1
            urgency_counts[r["advisory"]["urgency"]] = urgency_counts.get(r["advisory"]["urgency"], 0) + 1
            avg_ndvi += r["satellite_features"]["optical"]["NDVI"]
        avg_ndvi = round(avg_ndvi / total, 3) if total else 0

        try:
            recent_history = history_db.get_history(limit=10)
        except Exception:
            recent_history = []

        return jsonify({
            "total_fields": total,
            "avg_ndvi": avg_ndvi,
            "crop_distribution": crop_counts,
            "stress_distribution": stress_counts,
            "urgency_distribution": urgency_counts,
            "recent_history": recent_history,
        })
    except Exception as e:
        return jsonify({"error": f"Dashboard aggregation failed: {e}"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(
        host="0.0.0.0",
        port=port,
        debug=False,
        use_reloader=False
    )