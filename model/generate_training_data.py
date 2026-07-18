"""
generate_training_data.py
--------------------------
Synthetic-but-physically-grounded training set banata hai (spectral-temporal
signatures -> crop type, stress level). Isi tarah asli labelled Sentinel data
(bhavantar / IMD crop survey ground truth ke saath) is pipeline mein feed
hota — sirf yeh file replace karni hogi.
"""

import random
import csv
from datetime import date, timedelta
import sys, os
sys.path.append(os.path.dirname(__file__))
from satellite_sim import simulate_field, CROP_CALENDAR

random.seed(42)

OUT_PATH = os.path.join(os.path.dirname(__file__), "training_data.csv")

STRESS_LABELS = ["Healthy", "Mild Stress", "Moderate Stress", "Severe Stress"]


def stress_label(deficit_pct):
    if deficit_pct < 15:
        return STRESS_LABELS[0]
    elif deficit_pct < 30:
        return STRESS_LABELS[1]
    elif deficit_pct < 45:
        return STRESS_LABELS[2]
    else:
        return STRESS_LABELS[3]


def generate(n_samples=6000):
    rows = []
    crops = list(CROP_CALENDAR.keys())
    for i in range(n_samples):
        lat = round(random.uniform(20.0, 32.0), 4)   # Indo-Gangetic plain-ish range
        lon = round(random.uniform(75.0, 88.0), 4)
        crop = random.choice(crops)
        cal = CROP_CALENDAR[crop]
        offset = random.randint(0, cal["duration"])
        d = date(2026, 1, 1) + timedelta(days=(cal["sow_doy"] + offset) % 365)
        deficit = random.uniform(0, 60)

        rec = simulate_field(lat, lon, crop_hint=crop, when=d, irrigation_deficit_pct=deficit)
        rows.append({
            "NDVI": rec["optical"]["NDVI"],
            "NDWI": rec["optical"]["NDWI"],
            "MSI": rec["optical"]["MSI"],
            "VV_dB": rec["sar"]["VV_dB"],
            "VH_dB": rec["sar"]["VH_dB"],
            "VV_VH_ratio": rec["sar"]["VV_VH_ratio"],
            "growth_fraction": rec["growth_fraction"],
            "crop_label": crop,
            "stage_label": rec["growth_stage"],
            "stress_label": stress_label(deficit),
            "deficit_pct": round(deficit, 1),
        })
    return rows


if __name__ == "__main__":
    rows = generate()
    with open(OUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows -> {OUT_PATH}")
