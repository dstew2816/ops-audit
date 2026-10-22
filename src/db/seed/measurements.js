// station_specs, station_measurements — what the statistical process control
// layer reads.
//
// One metric per station: cycle_time_min, the minutes a unit spends being
// worked at that station. Readings are taken in subgroups of 5 (five units in a
// row), 30 subgroups per station across the analysis window. That shape is what
// an X-bar/R chart needs.
//
// Most stations are deliberately healthy, because a control chart that alarms on
// everything is useless. Three problems are planted, each one a different kind
// of failure that a different rule is meant to catch:
//
//   ST-3B  gradual drift. Subgroups 0-14 match lane A; from 15 the mean climbs
//          by DRIFT_PER_SUBGROUP each subgroup. Lane A stays put, so the two
//          lanes that should agree start to diverge. Run rules catch it long
//          before any single point is beyond a limit.
//   ST-4   one-off spike. Every reading in subgroup 22 is shifted up, as if the
//          station jammed for a while. A single point far beyond the limits.
//   ST-4   also has a wide spread to begin with, so its Cpk is mediocre even
//          when it is in control. In control and capable are different things.
//
// Expected outcomes are asserted in scripts/spc-check.mjs, not here.

import { HOUR, MIN, SEEDS, WINDOW_START, iso, lcg } from './common.js';

const rand = lcg(SEEDS.measurements);

export const SUBGROUPS = 30;
export const SUBGROUP_SIZE = 5;
export const DRIFT_START = 15;
export const DRIFT_PER_SUBGROUP = 1.0;
export const SPIKE_STATION = 'ST-4';
export const SPIKE_SUBGROUP = 22;
export const SPIKE_SHIFT = 14;

// mean and sd are what the generator draws from; lsl/usl/target are the spec.
const PROFILE = {
  'ST-1': { mean: 30, sd: 3, lsl: 15, usl: 45 },
  'ST-2': { mean: 35, sd: 3.5, lsl: 15, usl: 55 },
  'ST-3A': { mean: 90, sd: 6, lsl: 60, usl: 120 },
  'ST-3B': { mean: 90, sd: 6, lsl: 60, usl: 120 },
  'ST-4': { mean: 45, sd: 6, lsl: 25, usl: 65 },
  'ST-5': { mean: 25, sd: 2.5, lsl: 10, usl: 40 },
  'ST-6': { mean: 20, sd: 2, lsl: 8, usl: 32 },
};

export const stationSpecs = Object.entries(PROFILE).map(([station_id, p]) => ({
  station_id,
  metric: 'cycle_time_min',
  unit: 'min',
  lsl: p.lsl,
  usl: p.usl,
  target: p.mean,
}));

// Box-Muller: two uniforms in, one standard normal out.
const normal = () => {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

// Subgroups are spread evenly across the window, readings 4 minutes apart.
const SPACING = (14 * 24 * HOUR - 12 * HOUR) / SUBGROUPS;

export const stationMeasurements = [];

for (const [stationId, p] of Object.entries(PROFILE)) {
  for (let k = 0; k < SUBGROUPS; k += 1) {
    let mean = p.mean;
    if (stationId === 'ST-3B' && k >= DRIFT_START) {
      mean += (k - DRIFT_START + 1) * DRIFT_PER_SUBGROUP;
    }
    if (stationId === SPIKE_STATION && k === SPIKE_SUBGROUP) mean += SPIKE_SHIFT;

    for (let i = 0; i < SUBGROUP_SIZE; i += 1) {
      const value = Math.round((mean + p.sd * normal()) * 10) / 10;
      stationMeasurements.push({
        station_id: stationId,
        subgroup: k,
        seq: i,
        measured_at: iso(WINDOW_START + 6 * HOUR + k * SPACING + i * 4 * MIN),
        value,
      });
    }
  }
}
