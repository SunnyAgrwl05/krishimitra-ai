"""
satellite_sim.py
-----------------
Real Sentinel-2 (optical) + Sentinel-1 (SAR) data ka structure follow karke
deterministic, physically-plausible spectral signatures generate karta hai.

Kyun simulate? Live Google Earth Engine / Copernicus API access is sandbox
mein available nahi hai (network allow-list ke bahar). Isliye hum har field
ke liye seeded-random signal banate hain jo crop calendars aur known crop
spectral behaviour (NDVI growth curve, SAR VV/VH moisture response) follow
karta hai -- taaki AI pipeline ka baaki hissa (feature extraction, model,
decision engine) EXACTLY waisa kaam kare jaisa real data ke saath karega.
Jab real Sentinel/NISAR access mile, sirf yeh module replace karna hoga --
baaki system untouched rahega.
"""

import hashlib
import math
from datetime import date, datetime


CROP_CALENDAR = {
    # crop: (sowing_doy, total_duration_days, peak_ndvi, water_need_mm_per_day_peak)
    "Wheat":  {"sow_doy": 305, "duration": 130, "peak_ndvi": 0.82, "peak_water": 5.5},
    "Rice":   {"sow_doy": 160, "duration": 120, "peak_ndvi": 0.88, "peak_water": 8.0},
    "Maize":  {"sow_doy": 180, "duration": 100, "peak_ndvi": 0.85, "peak_water": 6.0},
    "Pulses": {"sow_doy": 275, "duration": 90,  "peak_ndvi": 0.65, "peak_water": 3.5},
}

STAGES = ["Sowing", "Vegetative", "Heading/Flowering", "Maturity", "Harvest"]


def _seed_from(lat, lon, d: date):
    key = f"{round(lat,4)}_{round(lon,4)}_{d.isoformat()}"
    h = hashlib.sha256(key.encode()).hexdigest()
    return int(h[:8], 16)


def _pseudo_random(seed, salt):
    h = hashlib.sha256(f"{seed}_{salt}".encode()).hexdigest()
    return (int(h[:8], 16) % 10000) / 10000.0  # 0..1


def growth_fraction(sow_doy, duration, doy):
    days_since = (doy - sow_doy) % 365
    if days_since > duration:
        return None  # out of season
    return days_since / duration


def stage_from_fraction(frac):
    if frac < 0.08:
        return STAGES[0]
    elif frac < 0.45:
        return STAGES[1]
    elif frac < 0.70:
        return STAGES[2]
    elif frac < 0.92:
        return STAGES[3]
    else:
        return STAGES[4]


def ndvi_curve(frac, peak):
    # bell-shaped growth curve: rises, peaks around heading, falls at maturity
    x = frac
    curve = math.sin(math.pi * min(max(x, 0), 1)) ** 0.7
    return round(0.12 + curve * (peak - 0.12), 3)


def simulate_field(lat, lon, crop_hint=None, when: date = None, irrigation_deficit_pct=None):
    """
    Returns a realistic optical+SAR feature bundle for one field/date,
    as if pulled from Sentinel-2 + Sentinel-1 (mirrors GEE output schema).
    """
    when = when or date.today()
    seed = _seed_from(lat, lon, when)
    doy = when.timetuple().tm_yday

    # pick the crop actually growing this DOY (deterministic per field)
    candidates = []
    for crop, cal in CROP_CALENDAR.items():
        frac = growth_fraction(cal["sow_doy"], cal["duration"], doy)
        if frac is not None:
            candidates.append((crop, cal, frac))

    if crop_hint and crop_hint in CROP_CALENDAR:
        cal = CROP_CALENDAR[crop_hint]
        frac = growth_fraction(cal["sow_doy"], cal["duration"], doy)
        if frac is None:
            frac = 0.5  # off-season manual override still simulated mid-cycle
        crop, chosen_frac = crop_hint, frac
    elif candidates:
        # deterministic pick via seed
        idx = seed % len(candidates)
        crop, cal, chosen_frac = candidates[idx]
    else:
        crop, cal, chosen_frac = "Wheat", CROP_CALENDAR["Wheat"], 0.5

    peak_ndvi = CROP_CALENDAR[crop]["peak_ndvi"]
    ndvi = ndvi_curve(chosen_frac, peak_ndvi)

    # water stress: random field-level deficit unless user forces a scenario
    if irrigation_deficit_pct is None:
        deficit = _pseudo_random(seed, "deficit") * 55  # 0-55% deficit
    else:
        deficit = irrigation_deficit_pct

    # NDWI drops as deficit rises (canopy water content)
    ndwi = round(0.45 - (deficit / 100.0) * 0.6 + _pseudo_random(seed, "ndwi_noise") * 0.03, 3)
    # MSI (moisture stress index) rises with deficit (inverse of NDWI-ish)
    msi = round(0.9 + (deficit / 100.0) * 1.1 + _pseudo_random(seed, "msi_noise") * 0.05, 3)

    # SAR VV/VH backscatter (dB) - moisture raises VV, vegetation structure affects VH
    vv = round(-9.5 + (1 - deficit / 100.0) * 3.0 + _pseudo_random(seed, "vv") * 0.4 - 12, 2)
    vh = round(-16.0 + (1 - deficit / 100.0) * 2.2 + ndvi * 1.5 + _pseudo_random(seed, "vh") * 0.4, 2)
    vv_vh_ratio = round(vv / vh, 3) if vh != 0 else 0.0

    stage = stage_from_fraction(chosen_frac)

    peak_water_need = CROP_CALENDAR[crop]["peak_water"]
    # crop water need scales with growth stage (low at sowing/harvest, peak at heading)
    stage_factor = math.sin(math.pi * chosen_frac) ** 0.6
    crop_water_need_mm = round(peak_water_need * (0.25 + 0.75 * stage_factor), 2)

    return {
        "lat": lat, "lon": lon, "date": when.isoformat(), "day_of_year": doy,
        "crop": crop, "growth_fraction": round(chosen_frac, 3), "growth_stage": stage,
        "optical": {"NDVI": ndvi, "NDWI": ndwi, "MSI": msi},
        "sar": {"VV_dB": vv, "VH_dB": vh, "VV_VH_ratio": vv_vh_ratio},
        "simulated_deficit_pct": round(deficit, 1),
        "crop_water_need_mm_day": crop_water_need_mm,
        "source": "Simulated Sentinel-2 + Sentinel-1 (schema-matched; swap-in ready for GEE)",
    }


if __name__ == "__main__":
    import json
    print(json.dumps(simulate_field(26.4165, 80.0725), indent=2))
