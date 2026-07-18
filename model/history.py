"""
history.py
-----------
SQLite-backed storage for past field analyses. Every call to /api/analyze
(in app.py) also logs a row here, so /api/history can list, search, and
filter previous results -- e.g. for a farmer/admin reviewing past advisories.
"""

import os
import sqlite3
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "history.db")


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = _connect()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS analysis_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            lat REAL, lon REAL,
            crop TEXT, growth_stage TEXT, stress_level TEXT, urgency TEXT,
            ndvi REAL, recommended_water_mm REAL,
            raw_json TEXT
        )
    """)
    conn.commit()
    conn.close()


def log_analysis(result):
    """result: the dict returned by app.run_pipeline()"""
    conn = _connect()
    feats = result["satellite_features"]
    adv = result["advisory"]
    conn.execute(
        "INSERT INTO analysis_history (created_at, lat, lon, crop, growth_stage, stress_level, "
        "urgency, ndvi, recommended_water_mm, raw_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            datetime.now().isoformat(),
            result["field"]["lat"], result["field"]["lon"],
            result["ai_prediction"]["predicted_crop"], feats["growth_stage"],
            adv["stress_level"], adv["urgency"], feats["optical"]["NDVI"],
            adv["recommended_water_mm"], json.dumps(result),
        ),
    )
    conn.commit()
    conn.close()


def get_history(limit=50, crop=None, urgency=None):
    conn = _connect()
    query = "SELECT * FROM analysis_history WHERE 1=1"
    params = []
    if crop:
        query += " AND crop = ?"
        params.append(crop)
    if urgency:
        query += " AND urgency = ?"
        params.append(urgency)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [
        {
            "id": r["id"], "created_at": r["created_at"], "lat": r["lat"], "lon": r["lon"],
            "crop": r["crop"], "growth_stage": r["growth_stage"], "stress_level": r["stress_level"],
            "urgency": r["urgency"], "ndvi": r["ndvi"], "recommended_water_mm": r["recommended_water_mm"],
        }
        for r in rows
    ]
