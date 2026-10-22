"""Real-data validation on the UCI SECOM dataset.

    python -I ml/real/secom_analysis.py [path/to/secom]

SECOM: 1,567 production runs, 590 anonymized sensor readings each, a pass/fail
label and a timestamp. McCann & Johnston (2008), UCI Machine Learning Repository,
https://doi.org/10.24432/C54305, CC BY 4.0. Download it first with
download_secom.py. (-I runs Python in isolated mode, which is the safe way to run
anything that reads downloaded files.)

EVERY CHOICE BELOW WAS FIXED BEFORE ANY RESULT WAS LOOKED AT:
  - runs are taken in timestamp order (the file is already sorted; checked)
  - the first 70% of runs (1,096) are TRAIN, the last 30% (471) are TEST
  - control limits come from the first 300 runs and are then held fixed
  - 8 sensors are charted: among those with <5% missing and >=100 distinct values
    in the baseline window, the 8 at evenly spaced positions in the eligible list.
    No label is used to choose them.
  - a failure counts as "flagged" if a chart signal occurred at that run or in the
    5 runs before it; windows of 0, 10 and 20 are reported as sensitivity
  - models are tuned by time-ordered cross-validation INSIDE the training period;
    the decision threshold is chosen from out-of-fold training predictions; the
    test period is scored once
Nothing is tuned on the test period, and every number is reported as it comes out.
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from scipy.stats import fisher_exact
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score
from sklearn.model_selection import GridSearchCV, TimeSeriesSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

sys.path.insert(0, str(Path(__file__).resolve().parent))
from real_spc import RULES, baseline_limits, chart_feature, self_test  # noqa: E402

warnings.filterwarnings("ignore", category=UserWarning)

SEED = 20260801
BASELINE_N = 300
TRAIN_FRAC = 0.7
N_SPC = 8
TOP_K = 5
WINDOWS = [0, 5, 10, 20]
PRIMARY_WINDOW = 5
BOOTSTRAPS = 1000

ROOT = Path(__file__).resolve().parent


def load(data_dir: Path) -> tuple[pd.DataFrame, np.ndarray, pd.DatetimeIndex]:
    X = pd.read_csv(data_dir / "secom.data", sep=r"\s+", header=None, na_values=["NaN"])
    rows = [line.split(None, 1) for line in (data_dir / "secom_labels.data").read_text().splitlines()]
    y = np.array([1 if int(r[0]) == 1 else 0 for r in rows])
    ts = pd.DatetimeIndex(pd.to_datetime([r[1].strip('"') for r in rows], format="%d/%m/%Y %H:%M:%S"))
    assert X.shape == (1567, 590) and len(y) == 1567
    assert ts.is_monotonic_increasing, "runs are expected in time order"
    X.columns = range(1, 591)  # sensor numbers are 1-based column positions
    return X, y, ts


def jsonable(value):
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else float(value)
    raise TypeError(type(value))


# --- 1. statistical process control ------------------------------------------
def spc_section(X: pd.DataFrame, y: np.ndarray, ts: pd.DatetimeIndex) -> tuple[dict, np.ndarray, dict]:
    base = X.iloc[:BASELINE_N]
    eligible = [c for c in X.columns if base[c].isna().mean() < 0.05 and base[c].nunique() >= 100]
    chosen = [eligible[(2 * i + 1) * len(eligible) // (2 * N_SPC)] for i in range(N_SPC)]

    features, flagged_by_run = [], np.zeros((len(X), N_SPC), dtype=bool)
    per_feature_signals = {}
    for k, col in enumerate(chosen):
        values = X[col].to_numpy(float)
        chart = chart_feature(values, BASELINE_N)
        post = {i: r for i, r in chart["signals"].items() if i >= BASELINE_N}
        for i in post:
            flagged_by_run[i, k] = True
        per_feature_signals[col] = chart["signals"]
        rule_counts = {r: sum(r in rs for rs in chart["signals"].values()) for r in RULES}
        post_observed = int((~np.isnan(values[BASELINE_N:])).sum())
        post_vals = values[BASELINE_N:][~np.isnan(values[BASELINE_N:])]
        base_vals = values[:BASELINE_N][~np.isnan(values[:BASELINE_N])]
        features.append(
            {
                "sensor": int(col),
                "missing_rate": round(float(np.isnan(values).mean()), 4),
                "baseline_mean": round(chart["cl"], 4),
                "baseline_sigma": round(chart["sigma"], 4),
                "ucl": round(chart["ucl"], 4),
                "lcl": round(chart["lcl"], 4),
                "n_observed": chart["n_observed"],
                "baseline_overall_sd": round(float(base_vals.std(ddof=1)), 4),
                "post_mean_shift_in_sigma": round(float((post_vals.mean() - chart["cl"]) / chart["sigma"]), 2),
                "post_sd_over_sigma": round(float(post_vals.std(ddof=1) / chart["sigma"]), 2),
                "signals_in_baseline": len(chart["signals"]) - len(post),
                "signals_total": len(chart["signals"]),
                "signals_post_baseline": len(post),
                "post_baseline_signal_rate": round(len(post) / post_observed, 4) if post_observed else None,
                "signals_by_rule": rule_counts,
                "values": [None if np.isnan(v) else round(float(v), 4) for v in values],
                "signal_runs": {str(i): rs for i, rs in sorted(chart["signals"].items())},
            }
        )
    section = {
        "n_eligible": len(eligible),
        "selection": f"{N_SPC} sensors at evenly spaced positions among {len(eligible)} sensors with <5% missing and >=100 distinct values in the baseline window; no label used",
        "baseline_runs": BASELINE_N,
        "chart": "individuals (limits = baseline mean +/- 3 x mean moving range / 1.128, held fixed)",
        "rules": RULES,
        "features": features,
        "capability": {
            "reported": False,
            "reason": "Sensors are anonymized and the dataset publishes no specification limits, so there is no defensible LSL or USL. Cpk and Ppk would need an invented spec, and inventing one would make the number meaningless. Only control-chart behaviour is reported.",
        },
    }
    return section, flagged_by_run, per_feature_signals


# --- 3. bridge to the audit ----------------------------------------------------
def bridge_section(y, ts, flagged_by_run, per_feature_signals, chosen_sensors) -> dict:
    n = len(y)
    any_signal = flagged_by_run.any(axis=1)
    cut = int(n * TRAIN_FRAC)

    def windowed(w: int) -> np.ndarray:
        out = np.zeros(n, dtype=bool)
        for i in range(n):
            out[i] = any_signal[max(0, i - w) : i + 1].any()
        return out

    def table(flag: np.ndarray, lo: int, hi: int) -> dict:
        idx = np.arange(lo, hi)
        fail, ok = idx[y[idx] == 1], idx[y[idx] == 0]
        ff, pf = int(flag[fail].sum()), int(flag[ok].sum())
        _, p = fisher_exact([[ff, len(fail) - ff], [pf, len(ok) - pf]])
        p_fail = ff / len(fail) if len(fail) else None
        p_pass = pf / len(ok) if len(ok) else None
        return {
            "failures": int(len(fail)),
            "failures_flagged": ff,
            "failures_silent": int(len(fail) - ff),
            "passes": int(len(ok)),
            "passes_flagged": pf,
            "share_failures_flagged": round(p_fail, 4) if p_fail is not None else None,
            "share_passes_flagged": round(p_pass, 4) if p_pass is not None else None,
            "lift": round(p_fail / p_pass, 3) if p_fail is not None and p_pass else None,
            "fisher_p": round(float(p), 4),
        }

    windows = {}
    for w in WINDOWS:
        flag = windowed(w)
        windows[str(w)] = {
            "after_baseline": table(flag, BASELINE_N, n),
            "test_period": table(flag, cut, n),
        }

    # what the signals before failures look like, for the primary window
    cols = list(chosen_sensors)
    examples_flagged, silent = [], []
    for i in np.flatnonzero(y == 1):
        if i < BASELINE_N:
            continue
        recent = None
        for back in range(0, PRIMARY_WINDOW + 1):
            j = i - back
            if j < 0:
                break
            hit = [(cols[k], flagged_by_run[j, k]) for k in range(len(cols)) if flagged_by_run[j, k]]
            if hit:
                recent = (back, j, [c for c, _ in hit])
                break
        record = {"run": int(i), "time": ts[i].isoformat(), "in_test_period": bool(i >= cut)}
        if recent:
            back, j, sensors = recent
            rules = sorted({r for s in sensors for r in per_feature_signals[s].get(j, [])})
            examples_flagged.append({**record, "runs_before": int(back), "sensors": [int(s) for s in sensors], "rules": rules})
        else:
            silent.append(record)

    by_sensor = {int(c): 0 for c in cols}
    for e in examples_flagged:
        for s in e["sensors"]:
            by_sensor[s] += 1
    per_sensor = []
    after = np.arange(BASELINE_N, n)
    for k, col in enumerate(cols):
        f = flagged_by_run[:, k]
        fail, ok = after[y[after] == 1], after[y[after] == 0]
        ff, pf = int(f[fail].sum()), int(f[ok].sum())
        _, p = fisher_exact([[ff, len(fail) - ff], [pf, len(ok) - pf]])
        per_sensor.append({
            "sensor": int(col),
            "share_failures_with_signal_at_run": round(ff / len(fail), 4),
            "share_passes_with_signal_at_run": round(pf / len(ok), 4),
            "fisher_p": round(float(p), 4),
        })
    return {
        "per_sensor_at_run": per_sensor,
        "primary_window_runs": PRIMARY_WINDOW,
        "definition": f"a failure is flagged if any charted sensor gave a signal at that run or in the {PRIMARY_WINDOW} runs before it (about {PRIMARY_WINDOW * 24 / (n / max((ts[-1] - ts[0]).days, 1)):.0f} hours at about {n / max((ts[-1] - ts[0]).days, 1):.0f} runs a day); passing runs are scored the same way, so the share of passes flagged is the false-alarm base rate",
        "windows": windows,
        "failures_flagged_by_sensor": by_sensor,
        "flagged_examples": examples_flagged[:12],
        "silent_failures": silent,
    }


# --- 2. classification ---------------------------------------------------------
def metrics_at(y_true, score, threshold) -> dict:
    pred = score >= threshold
    tp, fp = int(((pred) & (y_true == 1)).sum()), int(((pred) & (y_true == 0)).sum())
    fn, tn = int(((~pred) & (y_true == 1)).sum()), int(((~pred) & (y_true == 0)).sum())
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else 0.0
    return {
        "threshold": None if threshold is None else float(threshold),
        "precision": None if precision is None else round(precision, 4),
        "recall": None if recall is None else round(recall, 4),
        "f1": round(f1, 4),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "flagged_runs": int(pred.sum()),
    }


def bootstrap_ap(y_true, score, rng) -> list[float]:
    out = []
    n = len(y_true)
    for _ in range(BOOTSTRAPS):
        idx = rng.integers(0, n, n)
        if y_true[idx].sum() == 0:
            continue
        out.append(average_precision_score(y_true[idx], score[idx]))
    return [round(float(np.percentile(out, 2.5)), 4), round(float(np.percentile(out, 97.5)), 4)]


def best_threshold(y_true, score) -> float:
    """Threshold maximising F1 on the given (out-of-fold, training-period) scores."""
    best, best_f1 = float(score.max()), -1.0
    for t in np.unique(score):
        m = metrics_at(y_true, score, t)
        if m["f1"] > best_f1:
            best, best_f1 = float(t), m["f1"]
    return best


def curve(y_true, score, max_points=80) -> list[list[float]]:
    p, r, _ = precision_recall_curve(y_true, score)
    pts = np.column_stack([r, p])
    if len(pts) > max_points:
        pts = pts[np.linspace(0, len(pts) - 1, max_points).astype(int)]
    return [[round(float(a), 4), round(float(b), 4)] for a, b in pts]


def classification_section(X: pd.DataFrame, y: np.ndarray) -> dict:
    n = len(y)
    cut = int(n * TRAIN_FRAC)
    rng = np.random.default_rng(SEED)

    Xtr, Xte = X.iloc[:cut], X.iloc[cut:]
    ytr, yte = y[:cut], y[cut:]
    median = Xtr.median()
    keep = [c for c in X.columns if Xtr[c].nunique() > 1]
    Xtr_f, Xte_f = Xtr[keep].fillna(median[keep]), Xte[keep].fillna(median[keep])

    cv = TimeSeriesSplit(n_splits=5)
    grids = {
        "decision_tree": (
            DecisionTreeClassifier(class_weight="balanced", random_state=SEED),
            {"max_depth": [2, 3, 4, 6], "min_samples_leaf": [5, 10, 20]},
        ),
        "random_forest": (
            RandomForestClassifier(n_estimators=500, class_weight="balanced_subsample", random_state=SEED, n_jobs=1),
            {"max_depth": [None, 6], "min_samples_leaf": [1, 5]},
        ),
        "logistic_regression": (
            make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=3000)),
            {"logisticregression__C": [0.0005, 0.005, 0.05, 0.5]},
        ),
    }

    results, scores = {}, {}
    for name, (est, grid) in grids.items():
        search = GridSearchCV(est, grid, cv=cv, scoring="average_precision").fit(Xtr_f, ytr)
        # out-of-fold scores over the later part of training, for the threshold
        oof_y, oof_s = [], []
        for tr, va in cv.split(Xtr_f):
            fold = sklearn.base.clone(search.best_estimator_).fit(Xtr_f.iloc[tr], ytr[tr])
            oof_s.append(fold.predict_proba(Xtr_f.iloc[va])[:, 1])
            oof_y.append(ytr[va])
        oof_y, oof_s = np.concatenate(oof_y), np.concatenate(oof_s)
        threshold = best_threshold(oof_y, oof_s)
        # one look at the test period
        score = search.best_estimator_.predict_proba(Xte_f)[:, 1]
        scores[name] = score
        order = np.argsort(-score, kind="stable")
        top10 = order[: max(1, int(round(0.1 * len(yte))))]
        results[name] = {
            "best_params": {k.split("__")[-1]: (None if v is None else float(v) if isinstance(v, float) else int(v)) for k, v in search.best_params_.items()},
            "cv_pr_auc_mean": round(float(search.cv_results_["mean_test_score"][search.best_index_]), 4),
            "cv_pr_auc_std": round(float(search.cv_results_["std_test_score"][search.best_index_]), 4),
            "pr_auc": round(float(average_precision_score(yte, score)), 4),
            "pr_auc_ci95": bootstrap_ap(yte, score, rng),
            "roc_auc": round(float(roc_auc_score(yte, score)), 4),
            "at_threshold": metrics_at(yte, score, threshold),
            "recall_in_top_10pct": round(float(yte[top10].sum() / yte.sum()), 4),
            "precision_in_top_10pct": round(float(yte[top10].mean()), 4),
            "curve": curve(yte, score),
        }
        if name == "random_forest":
            forest = search.best_estimator_
            imp = sorted(zip(keep, forest.feature_importances_), key=lambda kv: -kv[1])[:8]
            results[name]["top_features"] = [{"sensor": int(c), "importance": round(float(v), 4)} for c, v in imp]

    # majority-class baseline: always predicts pass; a constant score has PR-AUC = prevalence
    maj = DummyClassifier(strategy="prior").fit(Xtr_f, ytr)
    maj_score = maj.predict_proba(Xte_f)[:, 1]
    results["majority_class"] = {
        "pr_auc": round(float(average_precision_score(yte, maj_score)), 4),
        "pr_auc_ci95": None,
        "roc_auc": 0.5,
        "at_threshold": metrics_at(yte, np.zeros(len(yte)), 1.0),
        "note": "Predicts pass for every run. It flags nothing, so precision is undefined and recall is 0.",
    }

    # simple rule baseline: flag a run if any of the top-k sensors is beyond its baseline 3-sigma limits.
    # The k sensors are the ones whose values best separate fail from pass in the TRAINING period.
    seps = {}
    for c in keep:
        try:
            seps[c] = abs(roc_auc_score(ytr, Xtr_f[c]) - 0.5)
        except ValueError:
            seps[c] = 0.0
    top = [c for c, _ in sorted(seps.items(), key=lambda kv: -kv[1])[:TOP_K]]
    limits = {c: baseline_limits(X[c].to_numpy(float), BASELINE_N) for c in top}

    def rule_score(frame: pd.DataFrame) -> np.ndarray:
        out = np.zeros(len(frame))
        for c in top:
            z = (frame[c].to_numpy(float) - limits[c]["cl"]) / limits[c]["sigma"]
            out += np.nan_to_num(np.abs(z) > 3, nan=False)
        return out

    rscore = rule_score(Xte)
    results["control_chart_rule"] = {
        "pr_auc": round(float(average_precision_score(yte, rscore)), 4),
        "pr_auc_ci95": bootstrap_ap(yte, rscore, rng),
        "roc_auc": round(float(roc_auc_score(yte, rscore)), 4),
        "at_threshold": metrics_at(yte, rscore, 1.0),
        "top_sensors": [int(c) for c in top],
        "rule": f"flag a run if any of the top {TOP_K} sensors is beyond 3 sigma of its baseline limits; the {TOP_K} sensors are those whose training-period values best separate fail from pass",
        "curve": curve(yte, rscore),
    }

    n_tr_fail, n_te_fail = int(ytr.sum()), int(yte.sum())
    return {
        "protocol": {
            "split": f"by time: the first {cut} runs train, the last {n - cut} runs test",
            "tuning": "5-fold time-ordered cross-validation (expanding window) inside the training period, scored on PR-AUC",
            "threshold": "chosen to maximise F1 on out-of-fold training predictions, then applied unchanged to the test period",
            "test_set_used": "once, after all fitting, tuning and threshold choice",
            "missing_values": "filled with training-period medians; sensors constant in training are dropped",
            "features_used": len(keep),
        },
        "train": {"runs": cut, "failures": n_tr_fail, "fail_rate": round(n_tr_fail / cut, 4)},
        "test": {"runs": n - cut, "failures": n_te_fail, "fail_rate": round(n_te_fail / (n - cut), 4)},
        "models": results,
    }


def main() -> None:
    self_test()
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "secom"
    X, y, ts = load(data_dir)
    n = len(y)

    spc, flagged_by_run, per_feature_signals = spc_section(X, y, ts)
    chosen = [f["sensor"] for f in spc["features"]]
    bridge = bridge_section(y, ts, flagged_by_run, per_feature_signals, chosen)
    classification = classification_section(X, y)

    fails_by_fifth = [int(y[i * n // 5 : (i + 1) * n // 5].sum()) for i in range(5)]
    results = {
        "source": {
            "name": "SECOM",
            "citation": "McCann, M. & Johnston, A. (2008). SECOM [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C54305",
            "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
            "url": "https://archive.ics.uci.edu/dataset/179/secom",
            "note": "The raw files are not committed; ml/real/download_secom.py fetches them. This file contains derived results and the readings of the 8 charted sensors, shared under the same licence with credit.",
        },
        "dataset": {
            "runs": n,
            "sensors": 590,
            "failures": int(y.sum()),
            "fail_rate": round(float(y.mean()), 4),
            "first_run": ts[0].isoformat(),
            "last_run": ts[-1].isoformat(),
            "days": int((ts[-1] - ts[0]).days),
            "runs_per_day": round(n / max((ts[-1] - ts[0]).days, 1), 1),
            "failures_by_fifth_of_timeline": fails_by_fifth,
            "sensors_over_50pct_missing": int((X.isna().mean() > 0.5).sum()),
            "sensors_constant": int((X.nunique(dropna=True) <= 1).sum()),
            "duplicate_timestamps": int(ts.duplicated().sum()),
        },
        "timestamps": [t.isoformat() for t in ts],
        "failure_runs": [int(i) for i in np.flatnonzero(y == 1)],
        "spc": spc,
        "classification": classification,
        "bridge": bridge,
        "versions": {"python": sys.version.split()[0], "pandas": pd.__version__, "scikit-learn": sklearn.__version__},
    }

    out = ROOT / "results" / "secom_results.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, default=jsonable, ensure_ascii=False), encoding="utf-8")

    # console summary -------------------------------------------------------------
    d = results["dataset"]
    print(f"{d['runs']} runs, {d['failures']} failures ({d['fail_rate']:.1%}), {d['first_run'][:10]} to {d['last_run'][:10]}; failures by fifth of timeline {d['failures_by_fifth_of_timeline']}")
    print(f"SPC: {len(spc['features'])} sensors charted; sensors {chosen}")
    for f in spc["features"]:
        print(f"  sensor {f['sensor']:>3}: {f['signals_post_baseline']:>3} signal runs after baseline ({f['post_baseline_signal_rate']:.1%} of observed runs); by rule {f['signals_by_rule']}")
    c = classification
    print(f"train {c['train']}; test {c['test']}")
    for name, m in c["models"].items():
        at = m["at_threshold"]
        print(f"  {name:20s} PR-AUC {m['pr_auc']:.3f} {m.get('pr_auc_ci95') or ''}  precision {at['precision']}  recall {at['recall']}  tp/fp/fn {at['tp']}/{at['fp']}/{at['fn']}")
    b = bridge["windows"][str(PRIMARY_WINDOW)]["after_baseline"]
    print(f"bridge (window {PRIMARY_WINDOW}): {b['failures_flagged']}/{b['failures']} failures flagged ({b['share_failures_flagged']:.1%}) vs {b['share_passes_flagged']:.1%} of passes; lift {b['lift']}; Fisher p {b['fisher_p']}; silent failures {b['failures_silent']}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
