"""
model.py
========
Loads the trained model (models/best_model.pkl) and exposes a single
`predict_exam_score` function that the API layer calls.

The feature order MUST match training exactly:
    study_hours_per_day, attendance_percentage, mental_health_rating,
    sleep_hours, part_time_job

part_time_job is encoded exactly as LabelEncoder did during training:
    "No" -> 0, "Yes" -> 1
(confirmed in results/metrics.json -> encoding.part_time_job)
"""

import json
from pathlib import Path
from typing import Optional

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "models" / "best_model.pkl"
METRICS_PATH = ROOT / "results" / "metrics.json"

FEATURE_ORDER = [
    "study_hours_per_day",
    "attendance_percentage",
    "mental_health_rating",
    "sleep_hours",
    "part_time_job",
]

_model = None
_model_load_error: Optional[str] = None
_metrics = None


def _load_metrics():
    global _metrics
    if METRICS_PATH.exists():
        with open(METRICS_PATH) as f:
            _metrics = json.load(f)
    else:
        _metrics = None
    return _metrics


def get_part_time_job_encoding():
    """Return the encoding map recorded during training, falling back
    to the standard LabelEncoder alphabetical mapping if metrics are
    unavailable."""
    metrics = _metrics or _load_metrics()
    if metrics and "encoding" in metrics:
        return metrics["encoding"].get("part_time_job", {"No": 0, "Yes": 1})
    return {"No": 0, "Yes": 1}


def load_model():
    """Load the model once at startup. Any failure is captured so the
    API can report a clear error instead of crashing."""
    global _model, _model_load_error
    try:
        _model = joblib.load(MODEL_PATH)
        _model_load_error = None
    except Exception as exc:  # noqa: BLE001
        _model = None
        _model_load_error = str(exc)
    _load_metrics()
    return _model


def is_model_ready() -> bool:
    return _model is not None


def get_model_error() -> Optional[str]:
    return _model_load_error


def get_model_name() -> str:
    if _model is None:
        return "Unavailable"
    return type(_model).__name__


def get_metrics():
    return _metrics or _load_metrics()


def predict_exam_score(
    study_hours_per_day: float,
    attendance_percentage: float,
    mental_health_rating: float,
    sleep_hours: float,
    part_time_job: str,
) -> float:
    if _model is None:
        raise RuntimeError("Model is not loaded")

    encoding = get_part_time_job_encoding()
    if part_time_job not in encoding:
        raise ValueError(f"Unknown part_time_job value: {part_time_job}")

    ptj_encoded = encoding[part_time_job]

    features = np.array(
        [
            [
                study_hours_per_day,
                attendance_percentage,
                mental_health_rating,
                sleep_hours,
                ptj_encoded,
            ]
        ],
        dtype=float,
    )

    prediction = _model.predict(features)[0]
    prediction = float(np.clip(prediction, 0, 100))
    return round(prediction, 2)
