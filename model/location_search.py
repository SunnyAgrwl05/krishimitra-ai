"""
location_search.py
--------------------
Village/district/state search via OpenStreetMap's Nominatim API (free,
no key required). If the request fails (no internet in this environment,
rate limited, etc.) it returns an empty result list with a note --
callers should treat this gracefully rather than erroring out.
"""

try:
    import requests
except ImportError:
    requests = None

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
HEADERS = {"User-Agent": "KrishiMitra-ISRO-Hackathon/1.0"}


def search_location(query, limit=5):
    if not query or requests is None:
        return {"results": [], "note": "query missing ya requests library available nahi hai"}
    try:
        resp = requests.get(NOMINATIM_URL, params={
            "q": query, "format": "json", "addressdetails": 1, "limit": limit, "countrycodes": "in",
        }, headers=HEADERS, timeout=5)
        if resp.status_code != 200:
            return {"results": [], "note": f"Nominatim status {resp.status_code}"}
        data = resp.json()
        results = []
        for item in data:
            addr = item.get("address", {})
            results.append({
                "display_name": item.get("display_name"),
                "lat": float(item["lat"]), "lon": float(item["lon"]),
                "village": addr.get("village") or addr.get("hamlet") or addr.get("town"),
                "district": addr.get("state_district") or addr.get("county"),
                "state": addr.get("state"),
            })
        return {"results": results, "note": None}
    except Exception as e:
        return {"results": [], "note": f"Location search fail ho gayi: {e}"}
