"""Fast end-to-end smoke test of the ML pipeline, for continuous integration.

    python ml/ci_smoke.py

It does not retrain the full model (that takes minutes). It checks that the
pipeline still works and that the committed artefacts are still reproducible:

  1. The data generator is deterministic and reproduces the committed dataset.
  2. On a small fixed-seed dataset, the features, a decision tree, a random forest
     and both hand-rule sets run, and the learned models clear the majority-class
     floor by a margin. With only 9 training examples per type the tree is weak, so
     the margin is a tripwire for broken features, not a quality bar.
  3. The real-data SPC self-test passes (rules fire on constructed patterns).
  4. The committed results files still have the shape the site expects.

Nothing here writes to ml/results or ml/data.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "real"))

import generate_data as gen  # noqa: E402
from features import build_frame  # noqa: E402
from real_spc import self_test  # noqa: E402
from rules import rules_en, rules_multi  # noqa: E402
from taxonomy import KIND_OF, LEAVES  # noqa: E402

SMOKE_PER_LEAF = 12
failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label} {detail}")
    if not ok:
        failures.append(label)


def make_rows(per_leaf: int) -> list[dict]:
    """The same construction as generate_data.main(), kept in memory."""
    rng = random.Random(gen.SEED)
    rows = []
    for leaf in LEAVES:
        for _ in range(per_leaf):
            rows.append(gen.build_record(rng, leaf, len(rows)))
    rng.shuffle(rows)
    return rows


def main() -> int:
    print("1. generator is deterministic and reproduces the committed dataset")
    committed = (ROOT / "data" / "procedures.jsonl").read_text(encoding="utf-8").splitlines()
    regenerated = [json.dumps(r, ensure_ascii=False) for r in make_rows(gen.PER_LEAF)]
    check("committed ml/data/procedures.jsonl matches a fresh run", committed == regenerated, f"({len(committed)} records)")

    print("2. small fixed-seed pipeline")
    rows = make_rows(SMOKE_PER_LEAF)
    X, y, info = build_frame(rows)
    check("every specific type is present", y.nunique() == len(LEAVES), f"({y.nunique()} types, {len(rows)} records)")
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, stratify=y, random_state=gen.SEED)

    majority = DummyClassifier(strategy="most_frequent").fit(X_tr, y_tr).score(X_te, y_te)
    tree = DecisionTreeClassifier(max_depth=12, random_state=gen.SEED).fit(X_tr, y_tr).score(X_te, y_te)
    forest = RandomForestClassifier(n_estimators=60, random_state=gen.SEED, n_jobs=1).fit(X_tr, y_tr).score(X_te, y_te)
    check("tree is well above the majority-class floor", tree > majority + 0.15, f"(tree {tree:.2f}, majority {majority:.2f})")
    check("forest is well above the majority-class floor", forest > majority + 0.15, f"(forest {forest:.2f})")

    canon = info.loc[X_te.index].to_dict("records")
    truth = list(y_te)
    for name, rule in (("rules_en", rules_en), ("rules_multi", rules_multi)):
        out = [rule(c) for c in canon]
        kind_acc = float(np.mean([k == KIND_OF[t] for (k, _), t in zip(out, truth)]))
        check(f"{name} runs and finds the kind better than chance", kind_acc > 0.30, f"(kind accuracy {kind_acc:.2f})")

    print("3. real-data SPC self-test")
    try:
        self_test()
        check("run rules fire on constructed patterns", True)
    except AssertionError as error:
        check("run rules fire on constructed patterns", False, str(error))

    print("4. committed results keep the shape the site expects")
    results = json.loads((ROOT / "results" / "results.json").read_text(encoding="utf-8"))
    for key in ("dataset", "test_metrics", "feature_check", "tree", "hand_rules", "disagreements"):
        check(f"ml/results/results.json has '{key}'", key in results)
    check("at least 50 examples per specific type", results["dataset"]["per_leaf"] >= 50, f"({results['dataset']['per_leaf']})")
    real = json.loads((ROOT / "real" / "results" / "secom_results.json").read_text(encoding="utf-8"))
    for key in ("dataset", "spc", "classification", "bridge", "source"):
        check(f"ml/real/results/secom_results.json has '{key}'", key in real)

    print(f"\n{'All smoke checks passed.' if not failures else f'{len(failures)} check(s) failed.'}")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
