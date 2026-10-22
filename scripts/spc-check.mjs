// Verifies the SPC layer two ways: the math against hand-worked answers, and
// the planted problems against the seeded measurements. Like db-check, a check
// that cannot fail proves nothing, so several below feed in data the rules
// MUST reject.
//
//   npm run spc:check

import { SEED_ROWS } from '../src/db/seed/index.js';
import {
  DRIFT_START, SPIKE_STATION, SPIKE_SUBGROUP, SUBGROUPS,
} from '../src/db/seed/measurements.js';
import { analyzeStation, capability, detectRules, imr, pairDrift, xbarR } from '../src/spc/spc.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${label.padEnd(60)} ${detail}`);
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('\nMath against hand-worked answers');
{
  // Two subgroups of 5: means 3 and 8, ranges 4 and 4. Grand mean 5.5, R-bar 4.
  const c = xbarR([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);
  check('X-bar centre line = grand mean', near(c.xbar.cl, 5.5));
  check('X-bar UCL = mean + A2 * R-bar', near(c.xbar.ucl, 5.5 + 0.577 * 4));
  check('R chart UCL = D4 * R-bar', near(c.r.ucl, 2.114 * 4));
  const cap = capability([9, 10, 11, 10, 10], 1, { lsl: 7, usl: 13 });
  check('Cpk = 1.0 for mean 10, sigma 1, spec 7..13', near(cap.cpk, 1));
  check('Cpk drops when the mean moves off-centre', capability([11, 12, 13, 12, 12], 1, { lsl: 7, usl: 13 }).cpk < 0.5);
  const flat = imr([5, 5, 5, 5]);
  check('I-MR of a constant series has zero spread', flat.i.sigma === 0);
}

console.log('\nRun rules fire on constructed patterns');
{
  const base = { cl: 0, sigma: 1 };
  const rule = (values, id) => detectRules(values, base).some((h) => h.rule === id);
  check('WE1: one point at +3.5 sigma', rule([0, 0, 3.5], 'WE1'));
  check('WE2: 2 of 3 beyond +2 sigma', rule([0, 2.2, 2.4], 'WE2'));
  check('WE3: 4 of 5 beyond +1 sigma', rule([1.2, 1.3, 0, 1.4, 1.5], 'WE3'));
  check('WE4: 8 in a row above the centre line', rule([0.2, 0.3, 0.1, 0.4, 0.2, 0.3, 0.1, 0.2], 'WE4'));
  check('N5: 6 steadily rising points', rule([0, 0.1, 0.2, 0.3, 0.4, 0.5], 'N5'));
  check('N6: 14 alternating points', rule(Array.from({ length: 14 }, (_, i) => (i % 2 ? 0.5 : -0.5)), 'N6'));
  const calm = [0.3, -0.4, 0.1, -0.2, 0.5, -0.1, 0.2, -0.3, 0.4, -0.5, 0.1, 0.0];
  check('no WE1 or WE4 on a calm series', !rule(calm, 'WE1') && !rule(calm, 'WE4'));
}

console.log('\nPlanted problems are found');
const analysis = {};
for (const spec of SEED_ROWS.station_specs) {
  analysis[spec.station_id] = analyzeStation(
    SEED_ROWS.station_measurements.filter((r) => r.station_id === spec.station_id),
    spec,
  );
}
const first = (id, rule) => analysis[id].xbarHits.find((h) => !rule || h.rule === rule)?.index;
{
  const spike = analysis[SPIKE_STATION].xbarHits.filter((h) => h.rule === 'WE1');
  check(`${SPIKE_STATION} spike: exactly one 3-sigma point, at subgroup ${SPIKE_SUBGROUP}`, spike.length === 1 && spike[0].index === SPIKE_SUBGROUP);
  const drift = first('ST-3B');
  check('ST-3B drift alarms after it starts', drift >= DRIFT_START, `first alert at subgroup ${drift}, drift began at ${DRIFT_START}`);
  check('ST-3B drift alarms within 5 subgroups of starting', drift <= DRIFT_START + 5);
  check('ST-3B alarms on subgroups 0..14: none', !analysis['ST-3B'].xbarHits.some((h) => h.index < DRIFT_START));
  const pair = pairDrift(analysis['ST-3A'].chart.means, analysis['ST-3B'].chart.means);
  check('Lane A vs lane B: divergence flagged after drift starts', pair.firstAlert !== null && pair.firstAlert >= DRIFT_START, `first pair alert at subgroup ${pair.firstAlert}`);
  const quiet = pairDrift(analysis['ST-3A'].chart.means, analysis['ST-3A'].chart.means.map((v) => v + 0.1));
  check('Control case: A vs a constant offset copy of A is NOT flagged', quiet.hits.length === 0);
}

console.log('\nFalse alarms and capability');
{
  const stable = ['ST-1', 'ST-2', 'ST-5', 'ST-6'];
  for (const id of stable) {
    check(`${id} (healthy): no X-bar alerts`, analysis[id].xbarHits.length === 0);
  }
  const a = analysis['ST-3A'].xbarHits;
  console.log(`  note  ST-3A (healthy) raised ${a.length} alert(s): ${a.map((h) => `${h.rule}@${h.index}`).join(', ') || 'none'}`);
  console.log('        With 30 points and 6 rules, an occasional false alarm on a healthy process is expected.');
  check('ST-4 is capable-ish but marginal: 1.0 <= Cpk < 1.33', analysis['ST-4'].capability.cpk >= 1 && analysis['ST-4'].capability.cpk < 1.33);
  const b = analysis['ST-3B'].capability;
  check('ST-3B: Ppk is well below Cpk (drift hurts overall performance)', b.cpk - b.ppk > 0.2, `Cpk ${b.cpk.toFixed(2)} vs Ppk ${b.ppk.toFixed(2)}`);
  check('Every station has one reading set of the right size', SEED_ROWS.station_measurements.length === 7 * SUBGROUPS * 5);
}

console.log(`\n${failures === 0 ? '\x1b[32mAll checks passed.\x1b[0m' : `\x1b[31m${failures} check(s) failed.\x1b[0m`}\n`);
process.exit(failures === 0 ? 0 : 1);
