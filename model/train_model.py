"""
train_model.py
---------------
Trains two RandomForest models on the spectral-temporal feature set:
  1. Crop Classifier      : NDVI, NDWI, MSI, VV, VH, VV/VH, growth_fraction -> crop
  2. Moisture Stress Model: same features -> stress level (Healthy..Severe)

RandomForest chosen for the prototype (fast, interpretable, no GPU needed,
runs in the hackathon demo instantly). Production version documented in
README to upgrade to CNN-Transformer (crop) + LSTM-Attention (phenology)
once GPU + labelled multi-year Sentinel time series are available.
"""

import os
import json
import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report, f1_score

BASE = os.path.dirname(__file__)
DATA_PATH = os.path.join(BASE, "training_data.csv")
FEATURES = ["NDVI", "NDWI", "MSI", "VV_dB", "VH_dB", "VV_VH_ratio", "growth_fraction"]


def train_and_save():
    df = pd.read_csv(DATA_PATH)
    X = df[FEATURES]

    metrics = {}

    # --- Crop classifier ---
    y_crop = df["crop_label"]
    Xtr, Xte, ytr, yte = train_test_split(X, y_crop, test_size=0.2, random_state=42, stratify=y_crop)
    crop_model = RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42, n_jobs=-1)
    crop_model.fit(Xtr, ytr)
    pred = crop_model.predict(Xte)
    metrics["crop_model"] = {
        "accuracy": round(accuracy_score(yte, pred), 4),
        "f1_macro": round(f1_score(yte, pred, average="macro"), 4),
        "report": classification_report(yte, pred, output_dict=False),
    }
    joblib.dump(crop_model, os.path.join(BASE, "crop_model.pkl"))

    # --- Stress classifier ---
    y_stress = df["stress_label"]
    Xtr2, Xte2, ytr2, yte2 = train_test_split(X, y_stress, test_size=0.2, random_state=42, stratify=y_stress)
    stress_model = RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42, n_jobs=-1)
    stress_model.fit(Xtr2, ytr2)
    pred2 = stress_model.predict(Xte2)
    metrics["stress_model"] = {
        "accuracy": round(accuracy_score(yte2, pred2), 4),
        "f1_macro": round(f1_score(yte2, pred2, average="macro"), 4),
        "report": classification_report(yte2, pred2, output_dict=False),
    }
    joblib.dump(stress_model, os.path.join(BASE, "stress_model.pkl"))

    with open(os.path.join(BASE, "metrics.json"), "w") as f:
        json.dump({
            "crop_model": {"accuracy": metrics["crop_model"]["accuracy"], "f1_macro": metrics["crop_model"]["f1_macro"]},
            "stress_model": {"accuracy": metrics["stress_model"]["accuracy"], "f1_macro": metrics["stress_model"]["f1_macro"]},
            "features": FEATURES,
        }, f, indent=2)

    print("=== CROP MODEL ===")
    print(f"Accuracy: {metrics['crop_model']['accuracy']}  F1(macro): {metrics['crop_model']['f1_macro']}")
    print(metrics["crop_model"]["report"])
    print("=== STRESS MODEL ===")
    print(f"Accuracy: {metrics['stress_model']['accuracy']}  F1(macro): {metrics['stress_model']['f1_macro']}")
    print(metrics["stress_model"]["report"])
    print("Models saved: crop_model.pkl, stress_model.pkl, metrics.json")


if __name__ == "__main__":
    train_and_save()
