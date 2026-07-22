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

# Open-Meteo is free and needs no API key -- used for the multi-day forecast.
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes -> (human label, emoji icon).
# Ref: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
WMO_CODES = {
    0: ("Clear sky", "☀️"),
    1: ("Mainly clear", "🌤️"),
    2: ("Partly cloudy", "⛅"),
    3: ("Overcast", "☁️"),
    45: ("Fog", "🌫️"),
    48: ("Rime fog", "🌫️"),
    51: ("Light drizzle", "🌦️"),
    53: ("Drizzle", "🌦️"),
    55: ("Dense drizzle", "🌧️"),
    56: ("Freezing drizzle", "🌧️"),
    57: ("Freezing drizzle", "🌧️"),
    61: ("Light rain", "🌦️"),
    63: ("Rain", "🌧️"),
    65: ("Heavy rain", "🌧️"),
    66: ("Freezing rain", "🌧️"),
    67: ("Freezing rain", "🌧️"),
    71: ("Light snow", "🌨️"),
    73: ("Snow", "🌨️"),
    75: ("Heavy snow", "❄️"),
    77: ("Snow grains", "🌨️"),
    80: ("Rain showers", "🌦️"),
    81: ("Rain showers", "🌧️"),
    82: ("Violent showers", "⛈️"),
    85: ("Snow showers", "🌨️"),
    86: ("Snow showers", "❄️"),
    95: ("Thunderstorm", "⛈️"),
    96: ("Thunderstorm + hail", "⛈️"),
    99: ("Thunderstorm + hail", "⛈️"),
}


def _describe_code(code):
    """Maps a WMO weather code to a (label, icon) pair, with a safe default."""
    label, icon = WMO_CODES.get(code, ("Unknown", "🌡️"))
    return label, icon


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


def _farming_recommendation(daily):
    """Derives a short, actionable irrigation hint from the upcoming forecast.

    Rain in the next 3 days -> hold off on irrigation; a hot & dry stretch ->
    irrigate. Purely advisory text, never raises."""
    next3 = daily[:3]
    if not next3:
        return "Forecast data uplabdh nahi hai."
    rain_soon = sum(d["precip_mm"] for d in next3)
    max_prob = max((d["precip_prob_pct"] or 0) for d in next3)
    avg_high = sum(d["temp_max_c"] for d in next3) / len(next3)

    if rain_soon >= 10 or max_prob >= 60:
        return "🌧️ Agle 2-3 din barish sambhav — abhi sinchai rok dein, paani bachega."
    if avg_high >= 35 and rain_soon < 2:
        return "🔥 Garam aur sookha mausam — fasal ko sinchai ki zaroorat pad sakti hai."
    return "🌱 Mausam santulit — normal sinchai schedule follow karein."


def _simulated_forecast(lat, lon, days=7):
    """Deterministic multi-day forecast used when Open-Meteo is unreachable, so
    the dashboard always has something to show (mirrors _simulated_weather)."""
    from datetime import timedelta

    today = date.today()
    daily = []
    for i in range(days):
        d = today + timedelta(days=i)
        seed = int(hashlib.sha256(f"{round(lat,2)}_{round(lon,2)}_{d.isoformat()}".encode()).hexdigest()[:8], 16)
        temp_max = 24 + (seed % 14)                  # 24-38C
        temp_min = temp_max - (5 + (seed % 6))       # 5-10C cooler
        precip = round((seed % 800) / 100.0, 1)      # 0-8mm
        precip_prob = seed % 101                      # 0-100%
        wind = 4 + (seed % 26)                        # 4-30kph
        humidity = 35 + (seed % 55)                   # 35-90%
        code = 61 if precip > 4 else (2 if seed % 3 == 0 else 0)
        label, icon = _describe_code(code)
        daily.append({
            "date": d.isoformat(),
            "weather_code": code, "condition": label, "icon": icon,
            "temp_max_c": temp_max, "temp_min_c": temp_min,
            "precip_mm": precip, "precip_prob_pct": precip_prob, "wind_kph": wind,
            "humidity_pct": humidity,
        })

    now = _simulated_weather(lat, lon, today)
    cur_label, cur_icon = _describe_code(daily[0]["weather_code"])
    return {
        "lat": lat, "lon": lon, "timezone": "local",
        "current": {
            "temp_c": now["temp_c"], "humidity_pct": now["humidity_pct"],
            "precip_mm": now["rain_mm"], "wind_kph": now["wind_kph"],
            "weather_code": daily[0]["weather_code"], "condition": cur_label, "icon": cur_icon,
        },
        "daily": daily,
        "recommendation": _farming_recommendation(daily),
        "source": "Simulated (Open-Meteo reachable nahi tha)",
    }


def get_forecast(lat, lon, days=7):
    """7-day weather forecast (current + daily) via the free Open-Meteo API.

    Needs no API key. On any failure (no internet, timeout, bad response) it
    falls back to a deterministic simulated forecast so the dashboard never
    breaks -- same resilience contract as get_weather()."""
    days = max(1, min(int(days), 16))  # Open-Meteo supports up to 16 days
    if requests is not None:
        try:
            resp = requests.get(OPEN_METEO_URL, params={
                "latitude": lat, "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code",
                "hourly": "relative_humidity_2m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
                         "precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
                "timezone": "auto", "forecast_days": days, "wind_speed_unit": "kmh",
            }, timeout=6)
            if resp.status_code == 200:
                data = resp.json()
                cur = data.get("current", {})
                dl = data.get("daily", {})
                times = dl.get("time", [])
                # Open-Meteo has no daily humidity aggregate, so derive an accurate
                # per-day average from the hourly relative_humidity_2m series.
                daily_humidity = _daily_humidity_avg(data.get("hourly", {}))
                daily = []
                for i, day in enumerate(times):
                    code = _get(dl, "weather_code", i)
                    label, icon = _describe_code(code)
                    daily.append({
                        "date": day,
                        "weather_code": code, "condition": label, "icon": icon,
                        "temp_max_c": _get(dl, "temperature_2m_max", i),
                        "temp_min_c": _get(dl, "temperature_2m_min", i),
                        "precip_mm": _get(dl, "precipitation_sum", i) or 0.0,
                        "precip_prob_pct": _get(dl, "precipitation_probability_max", i) or 0,
                        "wind_kph": _get(dl, "wind_speed_10m_max", i),
                        "humidity_pct": daily_humidity.get(day),
                    })
                cur_label, cur_icon = _describe_code(cur.get("weather_code"))
                return {
                    "lat": lat, "lon": lon, "timezone": data.get("timezone", "auto"),
                    "current": {
                        "temp_c": cur.get("temperature_2m"),
                        "humidity_pct": cur.get("relative_humidity_2m"),
                        "precip_mm": cur.get("precipitation", 0.0),
                        "wind_kph": cur.get("wind_speed_10m"),
                        "weather_code": cur.get("weather_code"),
                        "condition": cur_label, "icon": cur_icon,
                    },
                    "daily": daily,
                    "recommendation": _farming_recommendation(daily),
                    "source": "Open-Meteo (live)",
                }
        except Exception as e:
            print(f"[weather.py] Open-Meteo fetch failed, using simulated fallback ({e})")
    return _simulated_forecast(lat, lon, days)


def _get(section, key, i):
    """Safely reads section[key][i] from an Open-Meteo response array."""
    arr = section.get(key) or []
    return arr[i] if i < len(arr) else None


def _daily_humidity_avg(hourly):
    """Averages the hourly relative_humidity_2m series into a {date: mean%} map.

    Open-Meteo doesn't expose a daily humidity aggregate, so we compute a real
    per-day mean from the 24 hourly readings (grouped by the YYYY-MM-DD prefix
    of each hourly timestamp). Returns rounded integers."""
    times = hourly.get("time") or []
    values = hourly.get("relative_humidity_2m") or []
    sums, counts = {}, {}
    for ts, val in zip(times, values):
        if val is None:
            continue
        day = ts[:10]
        sums[day] = sums.get(day, 0) + val
        counts[day] = counts.get(day, 0) + 1
    return {day: round(sums[day] / counts[day]) for day in sums if counts[day]}
