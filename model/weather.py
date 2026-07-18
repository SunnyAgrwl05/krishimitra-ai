"""
weather.py
-----------
OpenWeatherMap integration for rain/humidity/wind/forecast. Set env var
OPENWEATHER_API_KEY to enable live weather. Without a key (or if the
request fails -- no internet, rate limit, etc.) it automatically returns
a deterministic simulated forecast so the rest of the app keeps working.
"""

import os
import hashlib
from datetime import date

try:
    import requests
except ImportError:
    requests = None

OPENWEATHER_KEY = os.environ.get("OPENWEATHER_API_KEY")
OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"


def _simulated_weather(lat, lon, when=None):
    when = when or date.today()
    seed = int(hashlib.sha256(f"{round(lat,2)}_{round(lon,2)}_{when.isoformat()}".encode()).hexdigest()[:6], 16)
    rain_mm = round((seed % 1000) / 100.0, 1)          # 0-10mm
    humidity = 35 + (seed % 55)                          # 35-90%
    temp_c = 18 + (seed % 20)                             # 18-38C
    wind_kph = 3 + (seed % 25)                            # 3-28kph
    return {
        "lat": lat, "lon": lon, "date": when.isoformat(),
        "rain_mm": rain_mm, "humidity_pct": humidity, "temp_c": temp_c, "wind_kph": wind_kph,
        "forecast_note": "Halki barish agle 2-3 din mein sambhav hai" if rain_mm > 5 else "Agle kuch din mausam saaf rehne ki sambhavna hai",
        "source": "Simulated (set OPENWEATHER_API_KEY for live data)",
    }


def get_weather(lat, lon, when=None):
    if OPENWEATHER_KEY and requests is not None:
        try:
            resp = requests.get(OPENWEATHER_URL, params={
                "lat": lat, "lon": lon, "appid": OPENWEATHER_KEY, "units": "metric",
            }, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "lat": lat, "lon": lon, "date": (when or date.today()).isoformat(),
                    "rain_mm": data.get("rain", {}).get("1h", 0.0),
                    "humidity_pct": data.get("main", {}).get("humidity"),
                    "temp_c": data.get("main", {}).get("temp"),
                    "wind_kph": round(data.get("wind", {}).get("speed", 0) * 3.6, 1),
                    "forecast_note": data.get("weather", [{}])[0].get("description", ""),
                    "source": "OpenWeatherMap (live)",
                }
        except Exception as e:
            print(f"[weather.py] OpenWeatherMap fetch failed, using simulated fallback ({e})")
    return _simulated_weather(lat, lon, when)
