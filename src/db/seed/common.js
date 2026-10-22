// Shared constants and helpers for the seeders.
//
// Every seeder gets its OWN generator instance from its own seed. That is a
// deliberate departure from src/data/events.js, where a single sequential PRNG
// stream means any edit to generation order reshuffles the entire dataset.
// Here, changing the port seeder cannot move a single row in email_queue.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const WINDOW_START = Date.parse('2026-07-23T00:00:00Z');
export const ANALYSIS_END = Date.parse('2026-08-06T00:00:00Z');

/** The one unplanned platform outage. Six hours, no event replay on recovery. */
export const OUTAGE = {
  start: Date.parse('2026-07-29T02:00:00Z'),
  end: Date.parse('2026-07-29T08:00:00Z'),
};

/** Per-table seeds. Independent streams; order within a table still matters. */
export const SEEDS = {
  ports: 20260723,
  batches: 20260724,
  tools: 20260725,
  holds: 20260726,
  checks: 20260727,
  email: 20260728,
  asop: 20260729,
  stations: 20260730,
  measurements: 20260731,
};

/** Numerical Recipes LCG — same generator the existing dataset uses. */
export function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 'YYYY-MM-DDTHH:MM:SSZ' — exactly 20 chars, second resolution, always UTC. */
export const iso = (msValue) =>
  new Date(Math.round(msValue / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export const T = (isoString) => Date.parse(isoString);

/** Integer in [lo, hi]. */
export const between = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/** Deterministic choice from a list. */
export const pick = (rand, list) => list[Math.floor(rand() * list.length)];

export const overlapsOutage = (start, end) =>
  start < OUTAGE.end && end > OUTAGE.start;

/** Tool roster, shared by ports, tool status and scheduled checks. */
export const TOOL_IDS = Array.from(
  { length: 24 },
  (_, i) => `T-${String(i + 1).padStart(2, '0')}`,
);
