"""
test_app.py
-----------
Run: pytest -v
Covers: satellite simulator determinism, decision engine rules, and
the full Flask API (health, fields, analyze, metrics, error handling).
"""

import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "model"))

import pytest
from app import app as flask_app
from model.satellite_sim import simulate_field
from model.decision_engine import compute_advisory


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c


# ---------- satellite_sim ----------

def test_simulate_field_deterministic():
    r1 = simulate_field(26.4165, 80.0725, when=date(2026, 6, 27))
    r2 = simulate_field(26.4165, 80.0725, when=date(2026, 6, 27))
    assert r1 == r2, "Same lat/lon/date should always give the same simulated reading"


def test_simulate_field_ranges():
    r = simulate_field(25.0, 82.0, when=date(2026, 3, 15))
    assert -1 <= r["optical"]["NDVI"] <= 1
    assert 0 <= r["simulated_deficit_pct"] <= 100
    assert r["growth_stage"] in ["Sowing", "Vegetative", "Heading/Flowering", "Maturity", "Harvest"]


def test_forced_deficit_reflected_in_ndwi():
    low = simulate_field(25.0, 82.0, when=date(2026, 3, 15), irrigation_deficit_pct=0)
    high = simulate_field(25.0, 82.0, when=date(2026, 3, 15), irrigation_deficit_pct=55)
    assert low["optical"]["NDWI"] > high["optical"]["NDWI"], "Higher deficit should mean lower NDWI"


# ---------- decision_engine ----------

def test_advisory_healthy_no_water():
    rec = simulate_field(25.0, 82.0, when=date(2026, 3, 15), irrigation_deficit_pct=2)
    adv = compute_advisory(rec, "Healthy")
    assert adv["urgency"] == "Low"
    assert adv["recommended_water_mm"] == 0.0


def test_advisory_severe_high_water():
    rec = simulate_field(25.0, 82.0, when=date(2026, 3, 15), irrigation_deficit_pct=50)
    adv = compute_advisory(rec, "Severe Stress")
    assert adv["urgency"] == "Critical"
    assert adv["recommended_water_mm"] > 0


# ---------- API ----------

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json()["status"] == "ok"


def test_dashboard_loads(client):
    r = client.get("/")
    assert r.status_code == 200
    assert b"KrishiMitra" in r.data


def test_fields_endpoint(client):
    r = client.get("/api/fields")
    assert r.status_code == 200
    data = r.get_json()
    assert len(data) == 6
    for f in data:
        assert "advisory" in f
        assert "ai_prediction" in f


def test_analyze_valid(client):
    r = client.post("/api/analyze", json={"lat": 26.5, "lon": 80.3, "crop": "Wheat"})
    assert r.status_code == 200
    d = r.get_json()
    assert d["ai_prediction"]["predicted_crop"] in ["Wheat", "Rice", "Maize", "Pulses"]
    assert "recommended_water_mm" in d["advisory"]


def test_analyze_missing_latlon(client):
    r = client.post("/api/analyze", json={"lat": 26.5})
    assert r.status_code == 400


def test_analyze_bad_date(client):
    r = client.post("/api/analyze", json={"lat": 26.5, "lon": 80.3, "date": "not-a-date"})
    assert r.status_code == 400


def test_metrics_endpoint(client):
    r = client.get("/api/model-metrics")
    assert r.status_code == 200
    m = r.get_json()
    assert m["crop_model"]["accuracy"] > 0.5
    assert m["stress_model"]["accuracy"] > 0.7


# ---------- Phase 2: new endpoints ----------

def test_weather_endpoint(client):
    r = client.get("/api/weather?lat=26.5&lon=80.3")
    assert r.status_code == 200
    d = r.get_json()
    assert "rain_mm" in d and "humidity_pct" in d and "temp_c" in d


def test_weather_missing_params(client):
    r = client.get("/api/weather")
    assert r.status_code == 400


def test_search_location_missing_query(client):
    r = client.get("/api/search-location")
    assert r.status_code == 400


def test_search_location_no_crash(client):
    # No internet in sandboxed test env -> should still return 200 with empty/graceful results
    r = client.get("/api/search-location?q=Budaun")
    assert r.status_code == 200
    d = r.get_json()
    assert "results" in d


def test_history_empty_or_list(client):
    r = client.get("/api/history")
    assert r.status_code == 200
    assert isinstance(r.get_json(), list)


def test_history_logged_after_analyze(client):
    before = len(client.get("/api/history").get_json())
    client.post("/api/analyze", json={"lat": 27.1, "lon": 81.2, "crop": "Rice"})
    after = client.get("/api/history").get_json()
    assert len(after) == before + 1
    assert after[0]["crop"] == "Rice"


def test_dashboard_endpoint(client):
    r = client.get("/api/dashboard")
    assert r.status_code == 200
    d = r.get_json()
    assert d["total_fields"] == 6
    assert "crop_distribution" in d
    assert "urgency_distribution" in d
