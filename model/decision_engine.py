"""
decision_engine.py
--------------------
CROPWAT/Optirrig-style crop water balance ke simplified rules + ML stress
prediction ko combine karke field-specific irrigation advisory banata hai.
"""

STAGE_KC = {  # crop coefficient by growth stage (FAO-56 simplified)
    "Sowing": 0.35, "Vegetative": 0.75, "Heading/Flowering": 1.15,
    "Maturity": 0.65, "Harvest": 0.25,
}

STRESS_ACTION = {
    "Healthy":          {"urgency": "Low",      "action": "No irrigation needed abhi. Regular monitoring jaari rakhein."},
    "Mild Stress":       {"urgency": "Moderate", "action": "Halki sinchai 2-3 din ke andar karein."},
    "Moderate Stress":   {"urgency": "High",     "action": "Turant sinchai schedule karein — 24-48 ghante mein."},
    "Severe Stress":     {"urgency": "Critical", "action": "AAJ hi sinchai karein — wilting risk hai."},
}


def compute_advisory(rec, stress_label):
    """
    rec: dict from satellite_sim.simulate_field (has crop, growth_stage,
         crop_water_need_mm_day, optical, sar)
    stress_label: ML-predicted stress class
    Returns irrigation advisory dict (timing + amount + reasoning).
    """
    stage = rec["growth_stage"]
    kc = STAGE_KC.get(stage, 0.6)
    base_need = rec["crop_water_need_mm_day"]
    et_crop = round(base_need * kc, 2)  # simplified ETc = ET0-proxy * Kc

    stress_info = STRESS_ACTION.get(stress_label, STRESS_ACTION["Mild Stress"])

    # amount recommendation scales with stress severity
    amount_multiplier = {"Healthy": 0.0, "Mild Stress": 0.6, "Moderate Stress": 1.0, "Severe Stress": 1.4}
    water_mm = round(et_crop * amount_multiplier.get(stress_label, 0.6), 1)

    reasoning = []
    ndvi = rec["optical"]["NDVI"]
    ndwi = rec["optical"]["NDWI"]
    vv_vh = rec["sar"]["VV_VH_ratio"]
    if ndwi < 0.15:
        reasoning.append(f"NDWI kaafi kam hai ({ndwi}) — canopy water content low")
    if rec["simulated_deficit_pct"] > 30:
        reasoning.append(f"SAR-derived moisture deficit {rec['simulated_deficit_pct']}% detected")
    if ndvi < 0.35 and stage not in ("Sowing", "Harvest"):
        reasoning.append(f"NDVI ({ndvi}) expected se kam hai is growth stage ke liye")
    if not reasoning:
        reasoning.append("Sab spectral indicators normal range mein hain")

    return {
        "crop": rec["crop"],
        "growth_stage": stage,
        "stress_level": stress_label,
        "urgency": stress_info["urgency"],
        "action_hi": stress_info["action"],
        "recommended_water_mm": water_mm,
        "crop_water_demand_mm_day": et_crop,
        "reasoning": reasoning,
    }
