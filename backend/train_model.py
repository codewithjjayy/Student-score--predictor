"""
train_model.py
================
Reproducible training pipeline for the Student Predictor project.

This script is a *faithful, cleaned-up* version of the original
`script.py` / `analysis.ipynb` workflow that was provided with the
project. It performs the exact same steps:

    1. Load dataset
    2. Drop missing values
    3. Select the 5 production features + target
    4. Label-encode `part_time_job`
    5. Train/test split (80/20)
    6. Grid-search 3 candidate models (Linear Regression, Decision Tree,
       Random Forest) with 5-fold cross validation
    7. Evaluate with RMSE and R^2
    8. Select the model with the lowest RMSE (exactly as the original
       code did)
    9. Refit the winning model on the full dataset
   10. Save the model with joblib

FIX APPLIED (documented, not a silent change):
    The original notebook/script did not set `random_state` on the
    train/test split or on the estimators. This meant every run of the
    pipeline produced a different split and therefore different,
    non-reproducible metrics -- a problem for an academic project that
    needs to report trustworthy, stable evaluation numbers. We added
    `random_state=42` to `train_test_split` and to the tree-based
    estimators. No feature, encoding, model family, or hyperparameter
    grid was changed.

This script additionally saves the evaluation metrics + some dataset
statistics to `results/metrics.json` so the web dashboard can display
*real* numbers instead of inventing any.
"""

import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import GridSearchCV, train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.tree import DecisionTreeRegressor

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "student_habits_performance.csv"
MODEL_PATH = ROOT / "models" / "best_model.pkl"
RESULTS_PATH = ROOT / "results" / "metrics.json"

FEATURES = [
    "study_hours_per_day",
    "attendance_percentage",
    "mental_health_rating",
    "sleep_hours",
    "part_time_job",
]
TARGET = "exam_score"

RANDOM_STATE = 42


def main():
    df = pd.read_csv(DATA_PATH)
    df = df.dropna()
    df = df.drop_duplicates()

    df_model = df[FEATURES + [TARGET]].copy()

    le = LabelEncoder()
    df_model["part_time_job"] = le.fit_transform(df_model["part_time_job"])
    # LabelEncoder sorts classes alphabetically -> "No"=0, "Yes"=1
    encoding_map = {cls: int(idx) for idx, cls in enumerate(le.classes_)}

    X = df_model[FEATURES]
    y = df_model[TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE
    )

    models = {
        "Linear Regression": {
            "model": LinearRegression(),
            "params": {},
        },
        "Decision Tree": {
            "model": DecisionTreeRegressor(random_state=RANDOM_STATE),
            "params": {
                "max_depth": [3, 5, 10],
                "min_samples_split": [2],
            },
        },
        "Random Forest": {
            "model": RandomForestRegressor(random_state=RANDOM_STATE),
            "params": {
                "n_estimators": [50, 100],
                "max_depth": [5, 10],
            },
        },
    }

    results = []
    fitted_estimators = {}

    for name, config in models.items():
        print(f"Training {name}...")
        grid = GridSearchCV(
            config["model"],
            config["params"],
            cv=5,
            scoring="neg_mean_squared_error",
        )
        grid.fit(X_train, y_train)

        y_pred = grid.predict(X_test)
        rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        r2 = float(r2_score(y_test, y_pred))

        results.append(
            {
                "model": name,
                "best_params": grid.best_params_,
                "rmse": round(rmse, 4),
                "r2": round(r2, 4),
            }
        )
        fitted_estimators[name] = grid.best_estimator_

    results_df = pd.DataFrame(results).sort_values(by="rmse", ascending=True)
    best_row = results_df.iloc[0]
    best_model_name = best_row["model"]

    print(f"Best model selected by lowest RMSE: {best_model_name}")

    # Refit the winning model type on the FULL dataset, exactly as the
    # original notebook did, using fresh (unfitted) estimator + best params.
    best_config = models[best_model_name]
    final_model = best_config["model"]
    final_model.set_params(**best_row["best_params"]) if best_row["best_params"] else None
    final_model.fit(X, y)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(final_model, MODEL_PATH)
    print(f"Saved final model to {MODEL_PATH}")

    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    metrics_payload = {
        "features": FEATURES,
        "target": TARGET,
        "train_test_split": "80/20",
        "cross_validation": "5-Fold",
        "random_state": RANDOM_STATE,
        "encoding": {"part_time_job": encoding_map},
        "dataset_rows_used": int(len(df_model)),
        "models": [
            {
                "model": r["model"],
                "rmse": r["rmse"],
                "r2": r["r2"],
                "best_params": r["best_params"],
                "selected": bool(r["model"] == best_model_name),
            }
            for r in results
        ],
        "selected_model": best_model_name,
    }

    with open(RESULTS_PATH, "w") as f:
        json.dump(metrics_payload, f, indent=2)
    print(f"Saved metrics to {RESULTS_PATH}")


if __name__ == "__main__":
    main()
