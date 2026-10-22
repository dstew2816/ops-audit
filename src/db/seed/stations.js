// stations, station_visits, station_handoffs — the route batches take.
//
// A six-stage line: Intake -> Prep -> Process -> Verify -> Pack -> Release.
// Process runs on two parallel lanes (3A and 3B) doing the same job, so a batch
// takes one lane or the other. That pair is deliberate: stations that are meant
// to behave alike are what a cross-station drift check compares.
//
// The 24 batches are the same B-88xx batches that appear in batch_queue_events,
// so one batch can be followed from its queue deadlines to its physical route.
//
// These are context tables. No automated procedure watches them, so they add no
// candidates and cannot move the miss count; db-check asserts exactly that.

import {
  ANALYSIS_END, HOUR, MIN, SEEDS, WINDOW_START, between, iso, lcg,
} from './common.js';

const rand = lcg(SEEDS.stations);

export const stations = [
  { station_id: 'ST-1', name: 'Intake', seq: 1, lane: null },
  { station_id: 'ST-2', name: 'Prep', seq: 2, lane: null },
  { station_id: 'ST-3A', name: 'Process', seq: 3, lane: 'A' },
  { station_id: 'ST-3B', name: 'Process', seq: 3, lane: 'B' },
  { station_id: 'ST-4', name: 'Verify', seq: 4, lane: null },
  { station_id: 'ST-5', name: 'Pack', seq: 5, lane: null },
  { station_id: 'ST-6', name: 'Release', seq: 6, lane: null },
];

// Typical dwell at each station, in minutes, as [low, high].
const DWELL = {
  'ST-1': [15, 45],
  'ST-2': [20, 50],
  'ST-3A': [60, 110],
  'ST-3B': [60, 110],
  'ST-4': [25, 60],
  'ST-5': [15, 40],
  'ST-6': [10, 30],
};

// Gap between leaving one station and arriving at the next, in minutes.
const HANDOFF_GAP = [3, 25];

const BATCH_COUNT = 24;
const FIRST_BATCH = 8801;
// A route is about 6 hours of dwell plus handoffs; leave room before the end.
const LATEST_START = ANALYSIS_END - 14 * HOUR;

export const stationVisits = [];
export const stationHandoffs = [];

for (let i = 0; i < BATCH_COUNT; i += 1) {
  const batchId = `B-${FIRST_BATCH + i}`;
  const lane = i % 2 === 0 ? 'ST-3A' : 'ST-3B';
  const route = ['ST-1', 'ST-2', lane, 'ST-4', 'ST-5', 'ST-6'];

  let clock =
    WINDOW_START + HOUR + between(rand, 0, 11) * 24 * HOUR + between(rand, 0, 23) * HOUR + between(rand, 0, 59) * MIN;
  if (clock > LATEST_START) clock = LATEST_START - between(rand, 0, 60) * MIN;

  route.forEach((stationId, step) => {
    const [lo, hi] = DWELL[stationId];
    const arrived = clock;
    const departed = arrived + between(rand, lo, hi) * MIN;
    stationVisits.push({
      batch_id: batchId,
      station_id: stationId,
      arrived_at: iso(arrived),
      departed_at: iso(departed),
    });

    if (step < route.length - 1) {
      const nextArrival = departed + between(rand, ...HANDOFF_GAP) * MIN;
      stationHandoffs.push({
        batch_id: batchId,
        from_station: stationId,
        to_station: route[step + 1],
        departed_at: iso(departed),
        arrived_at: iso(nextArrival),
      });
      clock = nextArrival;
    }
  });
}
