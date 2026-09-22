"""
app.py  –  Student Predictor  –  Flask REST API
================================================
Exposes three endpoints used by the frontend:

    POST /predict       – run the ML model
    GET  /metrics       – model evaluation metrics (from results/metrics.json)
    GET  /dataset-stats – summary statistics from the CSV for the Insights page
    GET  /health        – simple up-check
"""

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

from model import load_model, predict_exam_score, is_model_ready, get_model_error, get_metrics

# ── paths ──────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "student_habits_performance.csv"

# ── app ────────────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=str(ROOT / "frontend"), static_url_path="")
CORS(app)

# load model at startup
load_model()


# ── helpers ────────────────────────────────────────────────────────────────────

def _make_error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def _validate_predict_payload(data: dict):
    required = {
        "study_hours_per_day": (0, 12),
        "attendance_percentage": (0, 100),
        "mental_health_rating": (1, 10),
        "sleep_hours": (0, 12),
    }
    errors = []
    for field, (lo, hi) in required.items():
        if field not in data:
            errors.append(f"Missing field: {field}")
            continue
        try:
            val = float(data[field])
        except (TypeError, ValueError):
            errors.append(f"{field} must be a number")
            continue
        if not (lo <= val <= hi):
            errors.append(f"{field} must be between {lo} and {hi}")

    ptj = data.get("part_time_job", "")
    if ptj not in ("Yes", "No"):
        errors.append("part_time_job must be 'Yes' or 'No'")

    return errors


# ── routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def serve_index():
    return app.send_static_file("index.html")


@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "model_ready": is_model_ready(),
        "model_error": get_model_error(),
    })


@app.route("/predict", methods=["POST"])
def predict():
    if not is_model_ready():
        return _make_error(f"Model not available: {get_model_error()}", 503)

    data = request.get_json(silent=True)
    if not data:
        return _make_error("Request body must be JSON")

    errors = _validate_predict_payload(data)
    if errors:
        return _make_error("; ".join(errors))

    try:
        score = predict_exam_score(
            study_hours_per_day=float(data["study_hours_per_day"]),
            attendance_percentage=float(data["attendance_percentage"]),
            mental_health_rating=float(data["mental_health_rating"]),
            sleep_hours=float(data["sleep_hours"]),
            part_time_job=data["part_time_job"],
        )
    except Exception as exc:  # noqa: BLE001
        return _make_error(f"Prediction failed: {exc}", 500)

    # Performance label (UI-only interpretation)
    if score >= 80:
        label = "Excellent"
        label_color = "green"
    elif score >= 70:
        label = "Good"
        label_color = "blue"
    elif score >= 60:
        label = "Fair"
        label_color = "yellow"
    elif score >= 50:
        label = "Needs Improvement"
        label_color = "orange"
    else:
        label = "At Risk"
        label_color = "red"

    return jsonify({
        "predicted_score": score,
        "performance_label": label,
        "performance_color": label_color,
    })


@app.route("/metrics")
def metrics():
    m = get_metrics()
    if m is None:
        return _make_error("Metrics not available", 404)
    return jsonify(m)


@app.route("/dataset-stats")
def dataset_stats():
    """Return aggregated statistics from the CSV for the Insights charts."""
    if not DATA_PATH.exists():
        return _make_error("Dataset not available", 404)

    try:
        df = pd.read_csv(DATA_PATH).dropna()

        def _bin_series(series, bins, labels):
            return (
                pd.cut(series, bins=bins, labels=labels, right=False)
                .value_counts()
                .reindex(labels, fill_value=0)
                .to_dict()
            )

        # Study hours vs exam score – mean score per study-hour bucket
        df["study_bucket"] = pd.cut(
            df["study_hours_per_day"],
            bins=[0, 2, 4, 6, 8, 10, 12.1],
            labels=["0-2", "2-4", "4-6", "6-8", "8-10", "10-12"],
            right=False,
        )
        study_vs_score = (
            df.groupby("study_bucket", observed=True)["exam_score"]
            .mean()
            .round(2)
            .to_dict()
        )

        # Attendance vs exam score
        df["att_bucket"] = pd.cut(
            df["attendance_percentage"],
            bins=[0, 20, 40, 60, 80, 100.1],
            labels=["0-20", "20-40", "40-60", "60-80", "80-100"],
            right=False,
        )
        att_vs_score = (
            df.groupby("att_bucket", observed=True)["exam_score"]
            .mean()
            .round(2)
            .to_dict()
        )

        # Sleep vs exam score
        df["sleep_bucket"] = pd.cut(
            df["sleep_hours"],
            bins=[0, 4, 6, 8, 10, 12.1],
            labels=["<4", "4-6", "6-8", "8-10", "10+"],
            right=False,
        )
        sleep_vs_score = (
            df.groupby("sleep_bucket", observed=True)["exam_score"]
            .mean()
            .round(2)
            .to_dict()
        )

        # Mental health vs exam score
        mh_vs_score = (
            df.groupby("mental_health_rating")["exam_score"]
            .mean()
            .round(2)
            .to_dict()
        )

        # Score distribution
        score_dist = _bin_series(
            df["exam_score"],
            bins=[0, 50, 60, 70, 80, 90, 101],
            labels=["<50", "50-60", "60-70", "70-80", "80-90", "90-100"],
        )

        # Part-time job vs mean score
        ptj_vs_score = (
            df.groupby("part_time_job")["exam_score"]
            .mean()
            .round(2)
            .to_dict()
        )

        return jsonify({
            "study_vs_score": study_vs_score,
            "attendance_vs_score": att_vs_score,
            "sleep_vs_score": sleep_vs_score,
            "mental_health_vs_score": {str(k): v for k, v in mh_vs_score.items()},
            "score_distribution": score_dist,
            "part_time_job_vs_score": ptj_vs_score,
            "total_students": int(len(df)),
            "avg_score": round(float(df["exam_score"].mean()), 2),
            "avg_study_hours": round(float(df["study_hours_per_day"].mean()), 2),
            "avg_attendance": round(float(df["attendance_percentage"].mean()), 2),
        })
    except Exception as exc:  # noqa: BLE001
        return _make_error(f"Failed to compute stats: {exc}", 500)


@app.route("/analyze", methods=["POST"])
def analyze():
    """Accept a list of student records and return predictions for all of them."""
    if not is_model_ready():
        return _make_error(f"Model not available: {get_model_error()}", 503)

    data = request.get_json(silent=True)
    if not data or "students" not in data:
        return _make_error("Request body must contain a 'students' array")

    students = data["students"]
    if not isinstance(students, list) or len(students) == 0:
        return _make_error("'students' must be a non-empty array")
    if len(students) > 50:
        return _make_error("Maximum 50 students per request")

    results = []
    for idx, s in enumerate(students):
        errors = _validate_predict_payload(s)
        if errors:
            return _make_error(f"Student {idx + 1}: {'; '.join(errors)}")
        try:
            score = predict_exam_score(
                study_hours_per_day=float(s["study_hours_per_day"]),
                attendance_percentage=float(s["attendance_percentage"]),
                mental_health_rating=float(s["mental_health_rating"]),
                sleep_hours=float(s["sleep_hours"]),
                part_time_job=s["part_time_job"],
            )
        except Exception as exc:  # noqa: BLE001
            return _make_error(f"Prediction failed for student {idx + 1}: {exc}", 500)

        if score >= 80:
            label, color = "Excellent", "green"
        elif score >= 70:
            label, color = "Good", "blue"
        elif score >= 60:
            label, color = "Fair", "yellow"
        elif score >= 50:
            label, color = "Needs Improvement", "orange"
        else:
            label, color = "At Risk", "red"

        results.append({
            "label":             s.get("label", f"Student {idx + 1}"),
            "predicted_score":   score,
            "performance_label": label,
            "performance_color": color,
            "inputs": {
                k: s[k] for k in [
                    "study_hours_per_day", "attendance_percentage",
                    "mental_health_rating", "sleep_hours", "part_time_job",
                ]
            },
        })

    scores = [r["predicted_score"] for r in results]
    return jsonify({
        "results":     results,
        "avg_score":   round(sum(scores) / len(scores), 2),
        "max_score":   max(scores),
        "min_score":   min(scores),
        "top_student": max(results, key=lambda r: r["predicted_score"])["label"],
    })


# ── run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
