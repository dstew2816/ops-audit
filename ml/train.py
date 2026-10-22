"""Train and evaluate the two-level procedure classifier.

    python ml/train.py

Discipline, in order:
  1. One stratified train/test split, fixed seed. The test set is not touched again
     until step 4.
  2. All tuning (tree depth, leaf size, forest depth) uses 5-fold cross-validation
     INSIDE the training set only.
  3. The final decision tree and forest are fit on the full training set with the
     parameters CV chose.
  4. Everything is scored ONCE on the held-out test set: the tree, the forest, both
     branching hand-rule sets, and a majority-class floor.
Nothing is adjusted after seeing test results.

The models predict the specific thing watched (33 classes). The KIND of check
(6 classes) is read off from that prediction, so both levels are scored from one
set of predictions.
"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_val_score, train_test_split
from sklearn.tree import DecisionTreeClassifier, export_text

sys.path.insert(0, str(Path(__file__).parent))

from features import build_frame  # noqa: E402
from generate_data import SEED  # noqa: E402
from rules import RULE_TEXT, rules_en, rules_multi  # noqa: E402
from taxonomy import KIND_OF, KINDS, LEAF_IDS, LEAVES  # noqa: E402

ROOT = Path(__file__).parent
TEST_SIZE = 0.25
CV_FOLDS = 5
LABELS = {leaf["id"]: leaf["name"][0] for leaf in LEAVES}


def wilson(correct: int, n: int, z: float = 1.96) -> list[float]:
    """95% interval for an accuracy."""
    if n == 0:
        return [0.0, 0.0]
    p = correct / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return [round(centre - half, 4), round(centre + half, 4)]


def prf(y_true, y_pred, labels) -> dict:
    p, r, f, s = precision_recall_fscore_support(y_true, y_pred, labels=labels, zero_division=0)
    return {
        lab: {"precision": round(float(a), 3), "recall": round(float(b), 3), "f1": round(float(c), 3), "support": int(d)}
        for lab, a, b, c, d in zip(labels, p, r, f, s)
    }


def score(y_leaf_true, y_leaf_pred, y_kind_pred=None) -> dict:
    kind_true = np.array([KIND_OF[x] for x in y_leaf_true])
    kind_pred = np.array(y_kind_pred if y_kind_pred is not None else [KIND_OF[x] for x in y_leaf_pred])
    leaf_true, leaf_pred = np.array(y_leaf_true), np.array(y_leaf_pred)
    n = len(leaf_true)
    leaf_ok, kind_ok = int((leaf_true == leaf_pred).sum()), int((kind_true == kind_pred).sum())
    within = int(((leaf_true == leaf_pred) & (kind_true == kind_pred)).sum())
    confusions = Counter((t, p) for t, p in zip(leaf_true, leaf_pred) if t != p)
    return {
        "kind_accuracy": round(kind_ok / n, 4),
        "kind_accuracy_ci95": wilson(kind_ok, n),
        "leaf_accuracy": round(leaf_ok / n, 4),
        "leaf_accuracy_ci95": wilson(leaf_ok, n),
        "within_kind_accuracy": round(within / kind_ok, 4) if kind_ok else 0.0,
        "kind_macro_f1": round(f1_score(kind_true, kind_pred, labels=KINDS, average="macro", zero_division=0), 4),
        "leaf_macro_f1": round(f1_score(leaf_true, leaf_pred, labels=LEAF_IDS, average="macro", zero_division=0), 4),
        "per_kind": prf(kind_true, kind_pred, KINDS),
        "per_leaf": prf(leaf_true, leaf_pred, LEAF_IDS),
        "kind_confusion": confusion_matrix(kind_true, kind_pred, labels=KINDS).tolist(),
        "leaf_confusion": confusion_matrix(leaf_true, leaf_pred, labels=LEAF_IDS).tolist(),
        "top_leaf_confusions": [
            {"truth": t, "predicted": p, "count": c} for (t, p), c in confusions.most_common(8)
        ],
    }


def slices(y_true, y_pred, info: pd.DataFrame) -> dict:
    ok = pd.Series(np.array(y_true) == np.array(y_pred), index=info.index)
    quality = info["weak"].map(lambda v: "vague" if v else "informative")
    out = {}
    for name, groups in (("language", info["lang"]), ("record_quality", quality)):
        out[name] = {
            str(g): {"n": int(len(idx)), "accuracy": round(float(ok[idx].mean()), 3)}
            for g, idx in groups.groupby(groups).groups.items()
        }
    return out


def describe(row: pd.Series) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "entity": row["entity"],
        "field": row["field"],
        "threshold": None if pd.isna(row["threshold"]) else str(row["threshold"]),
        "condition": row["condition"],
        "language": row["lang"],
        "vague": bool(row["weak"]),
    }


def main() -> None:
    rows = [json.loads(line) for line in (ROOT / "data" / "procedures.jsonl").read_text(encoding="utf-8").splitlines()]
    X, y, info = build_frame(rows)

    # 1. split ---------------------------------------------------------------
    idx_train, idx_test = train_test_split(X.index, test_size=TEST_SIZE, stratify=y, random_state=SEED)
    X_train, X_test, y_train, y_test = X.loc[idx_train], X.loc[idx_test], y.loc[idx_train], y.loc[idx_test]
    info_test = info.loc[idx_test]

    # 2-3. tune by CV on train only, then fit on all of train -----------------
    cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=SEED)
    tree_search = GridSearchCV(
        DecisionTreeClassifier(random_state=SEED),
        {"max_depth": [8, 12, 16, None], "min_samples_leaf": [1, 2, 3]},
        cv=cv,
        scoring="accuracy",
    ).fit(X_train, y_train)
    forest_search = GridSearchCV(
        RandomForestClassifier(n_estimators=300, random_state=SEED, n_jobs=1),
        {"max_depth": [12, None], "min_samples_leaf": [1, 2]},
        cv=cv,
        scoring="accuracy",
    ).fit(X_train, y_train)
    tree, forest = tree_search.best_estimator_, forest_search.best_estimator_
    majority = DummyClassifier(strategy="most_frequent").fit(X_train, y_train)

    # Does any single feature give away the label? Everything here uses the
    # TRAINING set only (cross-validation), never the test set.
    best = {k: (None if v is None else int(v)) for k, v in tree_search.best_params_.items()}

    def cv_acc(columns, estimator=None):
        est = estimator or DecisionTreeClassifier(random_state=SEED, **best)
        return float(cross_val_score(est, X_train[columns], y_train, cv=cv).mean())

    single = sorted(
        ((col, cv_acc([col], DecisionTreeClassifier(max_depth=4, random_state=SEED))) for col in X_train.columns),
        key=lambda kv: -kv[1],
    )
    all_cols = list(X_train.columns)
    is_threshold = lambda c: c.startswith("threshold_") or c == "log_threshold_min"
    is_condition = lambda c: c.startswith("cond_") or c.startswith("cexpr_")
    ablation = {
        "all_features": cv_acc(all_cols),
        "without_threshold_features": cv_acc([c for c in all_cols if not is_threshold(c)]),
        "without_condition_features": cv_acc([c for c in all_cols if not is_condition(c)]),
        "without_both": cv_acc([c for c in all_cols if not is_threshold(c) and not is_condition(c)]),
    }
    importances_all = sorted(zip(X.columns, tree.feature_importances_), key=lambda kv: -kv[1])
    feature_check = {
        "top_importance_share": round(float(importances_all[0][1]), 4),
        "top_importance_feature": importances_all[0][0],
        "best_single_feature": [{"feature": f, "cv_accuracy": round(a, 4)} for f, a in single[:5]],
        "ablation_cv_accuracy": {k: round(v, 4) for k, v in ablation.items()},
        "chance": round(1 / len(LEAF_IDS), 4),
    }

    def cv_summary(search):
        i = search.best_index_
        return {
            "best_params": {k: (None if v is None else int(v)) for k, v in search.best_params_.items()},
            "cv_leaf_accuracy_mean": round(float(search.cv_results_["mean_test_score"][i]), 4),
            "cv_leaf_accuracy_std": round(float(search.cv_results_["std_test_score"][i]), 4),
        }

    # 4. one look at the test set -------------------------------------------
    canon_test = info_test.to_dict("records")
    en = [rules_en(c) for c in canon_test]
    multi = [rules_multi(c) for c in canon_test]
    preds = {
        "decision_tree": (tree.predict(X_test), None),
        "random_forest": (forest.predict(X_test), None),
        "rules_en": (np.array([leaf for _, leaf in en]), [kind for kind, _ in en]),
        "rules_multi": (np.array([leaf for _, leaf in multi]), [kind for kind, _ in multi]),
        "majority_class": (majority.predict(X_test), None),
    }
    truth = np.array(y_test)
    metrics = {}
    for name, (leaf_pred, kind_pred) in preds.items():
        metrics[name] = score(truth, leaf_pred, kind_pred)
        metrics[name]["by_slice"] = slices(truth, leaf_pred, info_test)

    # disagreements: learned tree vs English hand rules, at the specific level
    t_pred, r_pred = preds["decision_tree"][0], preds["rules_en"][0]
    differ = np.where(t_pred != r_pred)[0]
    categories = {
        "tree_right_rules_wrong": int(((t_pred == truth) & (r_pred != truth)).sum()),
        "rules_right_tree_wrong": int(((r_pred == truth) & (t_pred != truth)).sum()),
        "both_wrong": int(((t_pred != truth) & (r_pred != truth)).sum()),
        "both_right": int(((t_pred == truth) & (r_pred == truth)).sum()),
    }
    examples = [
        {
            **describe(info_test.iloc[i]),
            "truth": str(truth[i]),
            "tree": str(t_pred[i]),
            "rules": str(r_pred[i]),
            "who_is_right": "tree" if t_pred[i] == truth[i] else "rules" if r_pred[i] == truth[i] else "neither",
        }
        for i in differ
    ]
    shown = []
    for who in ("tree", "rules", "neither"):
        shown += [e for e in examples if e["who_is_right"] == who][:6]

    importances = sorted(zip(X.columns, tree.feature_importances_), key=lambda kv: -kv[1])
    results = {
        "task": "Classify a procedure definition: the kind of check, then the specific thing it watches.",
        "kinds": KINDS,
        "leaves": [
            {"id": leaf["id"], "kind": leaf["kind"], "label": LABELS[leaf["id"]]} for leaf in LEAVES
        ],
        "dataset": {
            "n": int(len(X)),
            "n_train": int(len(X_train)),
            "n_test": int(len(X_test)),
            "n_kinds": len(KINDS),
            "n_leaves": len(LEAF_IDS),
            "per_leaf": int(y.value_counts().min()),
            "languages": {k: int(v) for k, v in info["lang"].value_counts().items()},
            "vague_records": int(info["weak"].sum()),
            "missing_rate": {
                col: round(float(info[col].isna().mean()), 3)
                for col in ("name", "description", "entity", "field", "threshold", "condition")
            },
            "synthetic": True,
        },
        "protocol": {
            "split": f"stratified {int((1 - TEST_SIZE) * 100)}/{int(TEST_SIZE * 100)}, seed {SEED}",
            "tuning": f"{CV_FOLDS}-fold cross-validation on the training set only",
            "test_set_used": "once, after all fitting and tuning",
        },
        "cross_validation": {"decision_tree": cv_summary(tree_search), "random_forest": cv_summary(forest_search)},
        "test_metrics": metrics,
        "feature_check": feature_check,
        "tree": {
            "depth": int(tree.get_depth()),
            "leaves": int(tree.get_n_leaves()),
            "learned_rules_top": export_text(tree, feature_names=list(X.columns), max_depth=3),
            "top_features": [{"feature": f, "importance": round(float(v), 4)} for f, v in importances[:12] if v > 0],
        },
        "hand_rules": RULE_TEXT,
        "disagreements": {"summary": categories, "n_differ": int(len(differ)), "examples": shown},
        "versions": {"python": sys.version.split()[0], "pandas": pd.__version__, "scikit-learn": sklearn.__version__},
    }

    out = ROOT / "results" / "results.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    # console summary ---------------------------------------------------------
    cvt, cvf = results["cross_validation"]["decision_tree"], results["cross_validation"]["random_forest"]
    print(f"train {len(X_train)} / test {len(X_test)} | tree CV {cvt['cv_leaf_accuracy_mean']:.3f} | forest CV {cvf['cv_leaf_accuracy_mean']:.3f}")
    for name, m in metrics.items():
        print(
            f"  {name:15s} kind {m['kind_accuracy']:.3f}  specific {m['leaf_accuracy']:.3f}  "
            f"95% CI {m['leaf_accuracy_ci95']}  macro-F1 {m['leaf_macro_f1']:.3f}"
        )
    print(f"  disagreements tree vs rules_en: {categories}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
