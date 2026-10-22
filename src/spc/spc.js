// Statistical process control, from first principles. Pure functions, no
// dependencies, so the browser and scripts/spc-check.mjs run the same code.
//
// The one idea behind everything here: a process has two kinds of variation.
// Common-cause variation is the ordinary noise of a stable process. Special-
// cause variation is something that changed. A control chart draws the limits
// of ordinary noise (centre line +/- 3 standard deviations) so a point or a
// pattern outside them is evidence that something changed.
//
// Control limits are NOT spec limits. Control limits come from the data and say
// what the process does. Spec limits come from the customer and say what it
// must do. Capability (Cp/Cpk) compares the two.

// Constants for subgroups of size 5 (standard SPC tables).
export const N = 5;
export const D2 = 2.326; // converts average range to a standard deviation
export const A2 = 0.577; // X-bar limit factor: limits = centre +/- A2 * R-bar
export const D3 = 0; // R chart lower factor (zero for n < 7)
export const D4 = 2.114; // R chart upper factor
export const MR_D2 = 1.128; // d2 for moving ranges of 2, used by the I-MR chart

// Subgroups used to set the control limits. Limits come from a period assumed
// to be healthy (Phase I) and are then held fixed while later data is judged
// against them (Phase II). Setting limits from ALL the data would let a drift
// drag the centre line toward itself and hide, or even invert, the signal.
export const BASELINE = 15;

export const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

export const sampleSd = (values) => {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
};

/**
 * X-bar and R chart from an array of subgroups (each an array of readings).
 *
 * R-bar / d2 estimates the WITHIN-subgroup standard deviation, which is the
 * short-term noise. Using it for limits means a slow drift between subgroups
 * shows up as points outside the limits rather than inflating the limits.
 */
export function xbarR(subgroups, { baseline = subgroups.length } = {}) {
  const means = subgroups.map(mean);
  const ranges = subgroups.map((g) => Math.max(...g) - Math.min(...g));
  const grand = mean(means.slice(0, baseline));
  const rbar = mean(ranges.slice(0, baseline));
  const sigmaWithin = rbar / D2;
  return {
    means,
    ranges,
    xbar: { cl: grand, ucl: grand + A2 * rbar, lcl: grand - A2 * rbar, sigma: sigmaWithin / Math.sqrt(N) },
    r: { cl: rbar, ucl: D4 * rbar, lcl: D3 * rbar, sigma: null },
    sigmaWithin,
    // short-term noise over every subgroup, for capability
    sigmaWithinAll: mean(ranges) / D2,
    baseline,
  };
}

/**
 * Individuals and moving-range chart, for one reading at a time. The moving
 * range is the absolute difference between consecutive readings.
 */
export function imr(values) {
  const mr = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const cl = mean(values);
  const mrbar = mean(mr);
  const sigma = mrbar / MR_D2;
  return {
    values,
    mr,
    i: { cl, ucl: cl + 3 * sigma, lcl: cl - 3 * sigma, sigma },
    mrChart: { cl: mrbar, ucl: 3.267 * mrbar, lcl: 0 },
  };
}

/**
 * Process capability against spec limits.
 *
 *   Cp   = (USL - LSL) / (6 sigma)          how wide the spec is vs the noise
 *   Cpk  = min(USL - mean, mean - LSL) / (3 sigma)   same, but penalises being off-centre
 *
 * `sigmaWithin` gives Cp/Cpk (what the process can do when stable).
 * `sigmaOverall` (the plain standard deviation of every reading) gives Pp/Ppk
 * (what it actually did, including drift). A Cpk well above Ppk means the
 * process is capable when stable but did not stay stable.
 */
export function capability(readings, sigmaWithin, { lsl, usl }) {
  const m = mean(readings);
  const sigmaOverall = sampleSd(readings);
  const index = (sigma) => ({
    spread: (usl - lsl) / (6 * sigma),
    centred: Math.min(usl - m, m - lsl) / (3 * sigma),
  });
  const within = index(sigmaWithin);
  const overall = index(sigmaOverall);
  return {
    mean: m,
    sigmaWithin,
    sigmaOverall,
    cp: within.spread,
    cpk: within.centred,
    pp: overall.spread,
    ppk: overall.centred,
  };
}

export const RULES = {
  WE1: 'Western Electric 1: a point beyond 3 sigma',
  WE2: 'Western Electric 2: 2 of 3 points beyond 2 sigma, same side',
  WE3: 'Western Electric 3: 4 of 5 points beyond 1 sigma, same side',
  WE4: 'Western Electric 4: 8 points in a row on one side of the centre line',
  N5: 'Nelson 5: 6 points in a row steadily rising or falling',
  N6: 'Nelson 6: 14 points in a row alternating up and down',
};

/**
 * Run the out-of-control rules over a series.
 *
 * Each point is converted to z = (value - centre) / sigma, then every rule is
 * checked at every position. A violation is reported at the point that
 * COMPLETES the pattern, which is the first moment anyone could have known.
 *
 * @returns {{index:number, rule:string, detail:string}[]} sorted by index
 */
export function detectRules(values, { cl, sigma }) {
  const z = values.map((v) => (v - cl) / sigma);
  const hits = [];
  const add = (index, rule) => hits.push({ index, rule, detail: RULES[rule] });

  for (let i = 0; i < z.length; i += 1) {
    if (Math.abs(z[i]) > 3) add(i, 'WE1');

    const within = (count, threshold, required) => {
      if (i < count - 1) return false;
      const window = z.slice(i - count + 1, i + 1);
      const above = window.filter((v) => v > threshold).length;
      const below = window.filter((v) => v < -threshold).length;
      // the completing point must itself be part of the pattern
      return (above >= required && z[i] > threshold) || (below >= required && z[i] < -threshold);
    };
    if (within(3, 2, 2)) add(i, 'WE2');
    if (within(5, 1, 4)) add(i, 'WE3');

    if (i >= 7) {
      const w = z.slice(i - 7, i + 1);
      if (w.every((v) => v > 0) || w.every((v) => v < 0)) add(i, 'WE4');
    }
    if (i >= 5) {
      const w = values.slice(i - 5, i + 1);
      const steps = w.slice(1).map((v, j) => v - w[j]);
      if (steps.every((s) => s > 0) || steps.every((s) => s < 0)) add(i, 'N5');
    }
    if (i >= 13) {
      const w = values.slice(i - 13, i + 1);
      const steps = w.slice(1).map((v, j) => Math.sign(v - w[j]));
      if (steps.every((s, j) => s !== 0 && (j === 0 || s === -steps[j - 1]))) add(i, 'N6');
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * Cross-station drift: do two stations that should agree still agree?
 *
 * Take the subgroup-by-subgroup difference in means (b - a). While the pair
 * agrees, that difference hovers around a stable value. Learn its centre and
 * spread from a baseline period, then run the same rules over the rest. A
 * station drifting away from its partner makes the difference wander.
 *
 * The baseline is the first `baseline` subgroups. That is an assumption (the
 * pair was healthy then), and with only 15 points the spread estimate is rough.
 */
export function pairDrift(meansA, meansB, { baseline = BASELINE } = {}) {
  const diff = meansA.map((a, i) => meansB[i] - a);
  const base = diff.slice(0, baseline);
  const cl = mean(base);
  const sigma = sampleSd(base);
  const hits = detectRules(diff, { cl, sigma }).filter((h) => h.index >= baseline);
  const recent = diff.slice(-8);
  return {
    diff,
    cl,
    sigma,
    ucl: cl + 3 * sigma,
    lcl: cl - 3 * sigma,
    baseline,
    hits,
    firstAlert: hits.length ? hits[0].index : null,
    recentMeanGap: mean(recent) - cl,
  };
}

/** Group a flat, ordered list of readings into subgroups of N. */
export function toSubgroups(rows) {
  const byGroup = new Map();
  for (const row of rows) {
    if (!byGroup.has(row.subgroup)) byGroup.set(row.subgroup, []);
    byGroup.get(row.subgroup).push(row);
  }
  return [...byGroup.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([subgroup, items]) => ({
      subgroup,
      measuredAt: items[0].measured_at,
      values: items.sort((a, b) => a.seq - b.seq).map((r) => r.value),
    }));
}

/** Full analysis of one station's readings against its spec. */
export function analyzeStation(rows, spec) {
  const groups = toSubgroups(rows);
  const chart = xbarR(groups.map((g) => g.values), { baseline: BASELINE });
  const readings = rows.slice().sort((a, b) => a.subgroup - b.subgroup || a.seq - b.seq).map((r) => r.value);
  return {
    groups,
    chart,
    individuals: imr(readings),
    capability: capability(readings, chart.sigmaWithinAll, spec),
    xbarHits: detectRules(chart.means, chart.xbar),
    // The R chart is checked against its limits only: the zone rules assume a
    // symmetric distribution, which ranges are not.
    rangeHits: chart.ranges
      .map((value, index) => ({ index, rule: 'WE1', detail: 'Range beyond its control limit', value }))
      .filter((p) => p.value > chart.r.ucl),
  };
}
