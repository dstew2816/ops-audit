"""Individuals-chart SPC for real sensor series with missing values.

The same ideas as src/spc/spc.js, ported to Python so the real-data analysis can
run offline: limits are set from a baseline window and then held fixed, and the
Western Electric and Nelson rules are applied to every later point.

Missing readings are skipped: a chart is built over the OBSERVED points only, and
results are mapped back to run positions.
"""

from __future__ import annotations

import numpy as np

MR_D2 = 1.128  # d2 for moving ranges of 2

RULES = {
    "WE1": "a point beyond 3 sigma",
    "WE2": "2 of 3 points beyond 2 sigma, same side",
    "WE3": "4 of 5 points beyond 1 sigma, same side",
    "WE4": "8 points in a row on one side of the centre line",
    "N5": "6 points in a row steadily rising or falling",
    "N6": "14 points in a row alternating up and down",
}


def baseline_limits(values: np.ndarray, baseline_n: int) -> dict:
    """Centre line and sigma from the first `baseline_n` runs (observed points only)."""
    base = values[:baseline_n]
    base = base[~np.isnan(base)]
    mr = np.abs(np.diff(base))
    sigma = float(mr.mean() / MR_D2)
    cl = float(base.mean())
    return {"cl": cl, "sigma": sigma, "ucl": cl + 3 * sigma, "lcl": cl - 3 * sigma, "n_baseline_points": int(len(base))}


def detect_rules(series: np.ndarray, cl: float, sigma: float) -> list[tuple[int, str]]:
    """Run every rule over a series of observed values; return (index, rule) pairs.

    A violation is reported at the point that COMPLETES the pattern. Index is the
    position within `series` (the observed points).
    """
    z = (series - cl) / sigma
    hits: list[tuple[int, str]] = []
    for i in range(len(z)):
        if abs(z[i]) > 3:
            hits.append((i, "WE1"))
        for count, threshold, required, rule in ((3, 2, 2, "WE2"), (5, 1, 4, "WE3")):
            if i >= count - 1:
                window = z[i - count + 1 : i + 1]
                above, below = int((window > threshold).sum()), int((window < -threshold).sum())
                if (above >= required and z[i] > threshold) or (below >= required and z[i] < -threshold):
                    hits.append((i, rule))
        if i >= 7:
            w = z[i - 7 : i + 1]
            if (w > 0).all() or (w < 0).all():
                hits.append((i, "WE4"))
        if i >= 5:
            steps = np.diff(series[i - 5 : i + 1])
            if (steps > 0).all() or (steps < 0).all():
                hits.append((i, "N5"))
        if i >= 13:
            steps = np.sign(np.diff(series[i - 13 : i + 1]))
            if (steps != 0).all() and all(steps[j] == -steps[j - 1] for j in range(1, len(steps))):
                hits.append((i, "N6"))
    return hits


def chart_feature(values: np.ndarray, baseline_n: int) -> dict:
    """Limits from the baseline, rules over every observed point, mapped to run indices."""
    limits = baseline_limits(values, baseline_n)
    observed_idx = np.flatnonzero(~np.isnan(values))
    series = values[observed_idx]
    hits = detect_rules(series, limits["cl"], limits["sigma"])
    signals: dict[int, list[str]] = {}
    for i, rule in hits:
        signals.setdefault(int(observed_idx[i]), []).append(rule)
    return {**limits, "signals": signals, "n_observed": int(len(series))}


def self_test() -> None:
    """The rules must fire on constructed patterns and stay quiet on calm data."""
    rule = lambda vals, r: any(name == r for _, name in detect_rules(np.array(vals, float), 0.0, 1.0))
    assert rule([0, 0, 3.5], "WE1")
    assert rule([0, 2.2, 2.4], "WE2")
    assert rule([1.2, 1.3, 0, 1.4, 1.5], "WE3")
    assert rule([0.2, 0.3, 0.1, 0.4, 0.2, 0.3, 0.1, 0.2], "WE4")
    assert rule([0, 0.1, 0.2, 0.3, 0.4, 0.5], "N5")
    assert rule([(-0.5 if i % 2 else 0.5) for i in range(14)], "N6")
    calm = [0.3, -0.4, 0.1, -0.2, 0.5, -0.1, 0.2, -0.3, 0.4, -0.5, 0.1, 0.0]
    assert not rule(calm, "WE1") and not rule(calm, "WE4")
    lim = baseline_limits(np.array([1.0, 2.0, 1.0, 2.0, 1.0, 2.0]), 6)
    assert abs(lim["sigma"] - 1 / MR_D2) < 1e-9 and abs(lim["cl"] - 1.5) < 1e-9
    series = np.array([1.0, 2.0, 1.0, np.nan, 2.0, 1.0, 2.0, 9.0])
    result = chart_feature(series, 7)
    assert 7 in result["signals"] and "WE1" in result["signals"][7], "missing values must not shift run positions"
