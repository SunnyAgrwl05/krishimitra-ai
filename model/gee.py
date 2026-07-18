"""
gee.py
-------
Modular Google Earth Engine interface. Isko live GEE credentials milte hi
`ee.Initialize()` kaam karega aur real Sentinel-2/-1 data return karega.
Jab tak GEE available/authenticated nahi hai (ya `earthengine-api` install
nahi hai), yeh automatically `satellite_sim.py` (schema-matched simulator)
pe fallback karta hai -- baaki poora pipeline (feature extraction, AI model,
decision engine) bina kisi change ke chalta rehta hai.
"""

import os
import sys

sys.path.append(os.path.dirname(__file__))
from satellite_sim import simulate_field

_gee_initialized = False
_gee_available = False


def _try_init_gee():
    """Attempts one-time GEE initialization. Never raises -- always safe to call."""
    global _gee_initialized, _gee_available
    if _gee_initialized:
        return _gee_available
    _gee_initialized = True
    try:
        import ee  # noqa: F401  (only import succeeds if earthengine-api is installed)
        service_account = os.environ.get("GEE_SERVICE_ACCOUNT")
        key_path = os.environ.get("GEE_KEY_PATH")
        if service_account and key_path and os.path.exists(key_path):
            credentials = ee.ServiceAccountCredentials(service_account, key_path)
            ee.Initialize(credentials)
        else:
            ee.Initialize()
        _gee_available = True
    except Exception as e:
        # Any failure (not installed, no credentials, no network) -> fallback mode
        print(f"[gee.py] GEE not available, using simulator fallback ({type(e).__name__}: {e})")
        _gee_available = False
    return _gee_available


def fetch_sentinel(lat, lon, when=None, crop_hint=None, deficit=None):
    """
    Unified entry point used by app.py. Tries real GEE first; falls back to
    the deterministic simulator transparently. Return schema is identical
    either way, so downstream code never needs to know which path ran.
    """
    if _try_init_gee():
        try:
            return _fetch_from_gee(lat, lon, when)
        except Exception as e:
            print(f"[gee.py] GEE fetch failed, falling back to simulator ({e})")
    return simulate_field(lat, lon, crop_hint=crop_hint, when=when, irrigation_deficit_pct=deficit)


def _fetch_from_gee(lat, lon, when):
    """
    Real GEE implementation (only runs if `ee` import + Initialize succeeded).
    Pulls Sentinel-2 SR for NDVI/NDWI/MSI and Sentinel-1 GRD for VV/VH,
    reduced over a small buffer around the point.
    """
    import ee
    point = ee.Geometry.Point([lon, lat])
    region = point.buffer(50)  # 50m field buffer

    when = when or __import__("datetime").date.today()
    start = ee.Date(when.isoformat()).advance(-15, "day")
    end = ee.Date(when.isoformat())

    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
          .filterBounds(region).filterDate(start, end)
          .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
          .sort("CLOUDY_PIXEL_PERCENTAGE").first())

    ndvi = s2.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndwi = s2.normalizedDifference(["B3", "B8"]).rename("NDWI")
    msi = s2.select("B11").divide(s2.select("B8")).rename("MSI")

    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD")
          .filterBounds(region).filterDate(start, end)
          .filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
          .sort("system:time_start", False).first())

    vv = s1.select("VV")
    vh = s1.select("VH")

    stats = ee.Image.cat([ndvi, ndwi, msi, vv, vh]).reduceRegion(
        reducer=ee.Reducer.mean(), geometry=region, scale=10, maxPixels=1e9
    ).getInfo()

    return {
        "lat": lat, "lon": lon, "date": when.isoformat(),
        "optical": {"NDVI": round(stats.get("NDVI", 0), 3), "NDWI": round(stats.get("NDWI", 0), 3), "MSI": round(stats.get("MSI", 0), 3)},
        "sar": {"VV_dB": round(stats.get("VV", 0), 2), "VH_dB": round(stats.get("VH", 0), 2),
                "VV_VH_ratio": round(stats.get("VV", 0) / stats.get("VH", 1), 3) if stats.get("VH") else 0},
        "source": "Google Earth Engine — Sentinel-2 SR + Sentinel-1 GRD (live)",
    }


def to_geojson(fields):
    """Converts a list of field-result dicts (as produced by app.run_pipeline) to GeoJSON."""
    features = []
    for f in fields:
        if f.get("error"):
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [f["field"]["lon"], f["field"]["lat"]]},
            "properties": {
                "id": f["field"].get("id"), "name": f["field"].get("name"),
                "crop": f["ai_prediction"]["predicted_crop"],
                "stress": f["ai_prediction"]["predicted_stress"],
                "ndvi": f["satellite_features"]["optical"]["NDVI"],
            },
        })
    return {"type": "FeatureCollection", "features": features}
