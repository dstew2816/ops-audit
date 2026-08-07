// Raw state-change events emitted by monitored resources.
//
// `timestamp`       — when the state change actually happened (ground truth).
// `ingestTimestamp` — when the automation platform learned about it. Usually
//                     within seconds; occasionally much later. The live platform
//                     can only ever act on ingestTimestamp; this audit layer
//                     reconstructs from timestamp, which is precisely why it
//                     sees things the platform could not.
//
// Background traffic is emitted by a seeded LCG so the dataset is byte-for-byte
// reproducible across reloads and machines. Every planted case is written out
// literally below the generator and labelled.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const WINDOW_START = Date.parse('2026-07-23T00:00:00Z');
export const ANALYSIS_END = Date.parse('2026-08-06T00:00:00Z');

const T = (iso) => Date.parse(iso);

// ---------------------------------------------------------------------------
// Resource roster: 60 resources across 3 types.
// ---------------------------------------------------------------------------

const TYPE_SPECS = [
  { prefix: 'SVC', type: 'service', count: 20 },
  { prefix: 'TKT', type: 'ticket', count: 20 },
  { prefix: 'REQ', type: 'request', count: 20 },
];

const BENIGN_STATES = {
  service: ['healthy', 'degraded', 'restarting'],
  ticket: ['open', 'in_progress', 'closed_with_notes'],
  request: ['submitted', 'approved', 'fulfilled'],
};

const TRIGGER_SPEC = {
  service: { state: 'unresponsive', runbookId: 'RB-001', thresholdMinutes: 10, recovery: 'healthy' },
  ticket: { state: 'closed_no_notes', runbookId: 'RB-002', thresholdMinutes: 60, recovery: 'closed_with_notes' },
  request: { state: 'approaching_sla', runbookId: 'RB-003', thresholdMinutes: 25, recovery: 'fulfilled' },
};

export const resources = TYPE_SPECS.flatMap(({ prefix, type, count }) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(2, '0')}`,
    type,
  })),
);

// ---------------------------------------------------------------------------
// Planted-case resources. Their event streams are written literally further
// down, so the generator skips them entirely.
// ---------------------------------------------------------------------------

const PLANTED_RESOURCES = new Set([
  'SVC-07', 'SVC-12', 'TKT-05', 'REQ-09', // INFRASTRUCTURE — outage window
  'SVC-03',                               // LOGIC GAP — near-miss state string
  'TKT-14', 'TKT-15',                     // CONFIGURATION — over-broad exclusion
  'SVC-18',                               // DATA — 4h ingest lag
  'REQ-04',                               // DETECTOR ERROR — log just outside tolerance
]);

// Resources deliberately left without any qualifying episode. Four of these sit
// on runbook exclusion lists, so the only exclusion collisions in the dataset
// are the two planted CONFIGURATION cases.
const NO_EPISODE = new Set(['SVC-19', 'SVC-20', 'TKT-13', 'TKT-16', 'REQ-20']);

// Background resources whose episode is never actioned — organic misses that
// give the report texture beyond the planted set.
const ORGANIC_MISSES = new Set(['SVC-05', 'SVC-11', 'TKT-02', 'TKT-19', 'REQ-16']);

// The platform outage. Handled background episodes are steered clear of it so
// the only misses inside the window are the four planted ones.
const OUTAGE = { start: T('2026-07-29T02:00:00Z'), end: T('2026-07-29T08:00:00Z') };

// ---------------------------------------------------------------------------
// Deterministic PRNG (Numerical Recipes LCG).
// ---------------------------------------------------------------------------

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rand = lcg(20260806);

function ingestFor(ts, allowLongTail = true) {
  const roll = rand();
  if (allowLongTail && roll < 0.03) {
    // Rare multi-hour collector backlog.
    return ts + (1 + Math.floor(rand() * 3)) * HOUR + Math.floor(rand() * 60) * MIN;
  }
  if (roll < 0.12) return ts + (60 + Math.floor(rand() * 540)) * 1000;
  return ts + (1 + Math.floor(rand() * 45)) * 1000;
}

// ---------------------------------------------------------------------------
// Background traffic.
// ---------------------------------------------------------------------------

const generatedEvents = [];
const generatedEpisodes = [];

for (const resource of resources) {
  if (PLANTED_RESOURCES.has(resource.id)) continue;

  const pool = BENIGN_STATES[resource.type];
  const spec = TRIGGER_SPEC[resource.type];

  // Benign state walk: 3-5 changes spread across the window.
  const changeCount = 2 + Math.floor(rand() * 3);
  const times = Array.from({ length: changeCount }, () =>
    WINDOW_START + Math.floor(rand() * (ANALYSIS_END - WINDOW_START - 2 * HOUR)),
  ).sort((a, b) => a - b);

  let previous = pool[0];
  const benign = [{ t: WINDOW_START, state: previous }];
  for (const t of times) {
    let state = pool[Math.floor(rand() * pool.length)];
    if (state === previous) state = pool[(pool.indexOf(state) + 1) % pool.length];
    benign.push({ t, state });
    previous = state;
  }

  let episode = null;
  if (!NO_EPISODE.has(resource.id)) {
    const handled = !ORGANIC_MISSES.has(resource.id);
    const durationMinutes = spec.thresholdMinutes + 5 + Math.floor(rand() * 180);

    let start =
      WINDOW_START +
      Math.floor(rand() * 13) * DAY +
      Math.floor(rand() * 24) * HOUR +
      Math.floor(rand() * 60) * MIN;
    let end = start + durationMinutes * MIN;

    // A handled episode cannot overlap the outage — the platform was down.
    if (handled && start < OUTAGE.end && end > OUTAGE.start) {
      start += 18 * HOUR;
      end += 18 * HOUR;
    }
    if (end > ANALYSIS_END - HOUR) {
      const shift = end - (ANALYSIS_END - HOUR);
      start -= shift;
      end -= shift;
    }

    episode = {
      resourceId: resource.id,
      resourceType: resource.type,
      runbookId: spec.runbookId,
      start,
      end,
      durationMinutes,
      handled,
      tag: handled ? 'handled' : 'organic-miss',
    };
    generatedEpisodes.push(episode);
  }

  // Drop benign events that would truncate the episode interval.
  const kept = episode
    ? benign.filter((e) => e.t < episode.start || e.t > episode.end)
    : benign;

  for (const e of kept) {
    generatedEvents.push({
      resourceId: resource.id,
      resourceType: resource.type,
      state: e.state,
      timestamp: e.t,
    });
  }

  if (episode) {
    generatedEvents.push({
      resourceId: resource.id,
      resourceType: resource.type,
      state: spec.state,
      timestamp: episode.start,
    });
    generatedEvents.push({
      resourceId: resource.id,
      resourceType: resource.type,
      state: spec.recovery,
      timestamp: episode.end,
    });
  }
}

// ---------------------------------------------------------------------------
// PLANTED CASES — written literally.
// ---------------------------------------------------------------------------

const ev = (resourceId, resourceType, state, timestamp, ingestTimestamp) => ({
  resourceId,
  resourceType,
  state,
  timestamp: T(timestamp),
  ingestTimestamp: T(ingestTimestamp ?? timestamp) + 12_000,
});

const plantedEvents = [
  // --- INFRASTRUCTURE: four resources sat in a trigger state entirely inside
  // the 2026-07-29 02:00-08:00Z platform outage. Nothing fired; the platform
  // was not running and kept no record of the gap.
  ev('SVC-07', 'service', 'healthy', '2026-07-25T09:00:00Z'),
  ev('SVC-07', 'service', 'unresponsive', '2026-07-29T02:40:00Z'),
  ev('SVC-07', 'service', 'healthy', '2026-07-29T04:05:00Z'),
  ev('SVC-07', 'service', 'degraded', '2026-08-02T17:20:00Z'),

  ev('SVC-12', 'service', 'healthy', '2026-07-24T14:00:00Z'),
  ev('SVC-12', 'service', 'unresponsive', '2026-07-29T03:15:00Z'),
  ev('SVC-12', 'service', 'restarting', '2026-07-29T05:00:00Z'),
  ev('SVC-12', 'service', 'healthy', '2026-07-29T05:12:00Z'),

  ev('TKT-05', 'ticket', 'open', '2026-07-26T10:00:00Z'),
  ev('TKT-05', 'ticket', 'in_progress', '2026-07-27T11:00:00Z'),
  ev('TKT-05', 'ticket', 'closed_no_notes', '2026-07-29T02:20:00Z'),
  ev('TKT-05', 'ticket', 'closed_with_notes', '2026-07-29T06:10:00Z'),

  ev('REQ-09', 'request', 'submitted', '2026-07-27T08:00:00Z'),
  ev('REQ-09', 'request', 'approved', '2026-07-28T13:45:00Z'),
  ev('REQ-09', 'request', 'approaching_sla', '2026-07-29T04:10:00Z'),
  ev('REQ-09', 'request', 'fulfilled', '2026-07-29T07:30:00Z'),

  // --- LOGIC GAP: SVC-03 sat 40 minutes in "unresponsive_degraded". RB-001
  // matches the exact string "unresponsive", so neither the platform nor this
  // detector sees it. Present in the data, absent from the report.
  ev('SVC-03', 'service', 'healthy', '2026-07-24T06:00:00Z'),
  ev('SVC-03', 'service', 'degraded', '2026-07-30T18:10:00Z'),
  ev('SVC-03', 'service', 'healthy', '2026-07-30T19:00:00Z'),
  ev('SVC-03', 'service', 'unresponsive_degraded', '2026-08-01T13:20:00Z'),
  ev('SVC-03', 'service', 'healthy', '2026-08-01T14:00:00Z'),

  // --- CONFIGURATION: both sit on RB-002's exclusion list, bulk-added as a
  // contiguous TKT-13..TKT-16 range and never trimmed. Both qualify.
  ev('TKT-14', 'ticket', 'open', '2026-07-25T09:00:00Z'),
  ev('TKT-14', 'ticket', 'in_progress', '2026-07-26T12:00:00Z'),
  ev('TKT-14', 'ticket', 'closed_no_notes', '2026-07-31T10:15:00Z'),
  ev('TKT-14', 'ticket', 'closed_with_notes', '2026-07-31T12:43:00Z'),

  ev('TKT-15', 'ticket', 'open', '2026-07-24T08:30:00Z'),
  ev('TKT-15', 'ticket', 'closed_no_notes', '2026-08-02T15:40:00Z'),
  ev('TKT-15', 'ticket', 'closed_with_notes', '2026-08-02T18:20:00Z'),

  // --- DATA: the state change was real at 21:35 but did not reach the platform
  // until 01:35 the next morning, four hours later. By then the resource had
  // already recovered and the trigger condition no longer held.
  ev('SVC-18', 'service', 'healthy', '2026-07-28T11:00:00Z'),
  ev('SVC-18', 'service', 'unresponsive', '2026-08-03T21:35:00Z', '2026-08-04T01:35:00Z'),
  ev('SVC-18', 'service', 'healthy', '2026-08-03T22:50:00Z'),
  ev('SVC-18', 'service', 'degraded', '2026-08-05T07:15:00Z'),

  // --- DETECTOR ERROR: RB-003 did fire for this interval, 14 minutes after it
  // closed. The tolerance window allows 12. The detector reports a miss and is
  // wrong. Left unlabelled in the report by design.
  ev('REQ-04', 'request', 'submitted', '2026-07-26T09:00:00Z'),
  ev('REQ-04', 'request', 'approved', '2026-07-30T15:30:00Z'),
  ev('REQ-04', 'request', 'approaching_sla', '2026-08-04T09:10:00Z'),
  ev('REQ-04', 'request', 'fulfilled', '2026-08-04T10:30:00Z'),
];

const plantedEpisodes = [
  { resourceId: 'SVC-07', resourceType: 'service', runbookId: 'RB-001', start: T('2026-07-29T02:40:00Z'), end: T('2026-07-29T04:05:00Z'), handled: false, tag: 'infrastructure' },
  { resourceId: 'SVC-12', resourceType: 'service', runbookId: 'RB-001', start: T('2026-07-29T03:15:00Z'), end: T('2026-07-29T05:00:00Z'), handled: false, tag: 'infrastructure' },
  { resourceId: 'TKT-05', resourceType: 'ticket', runbookId: 'RB-002', start: T('2026-07-29T02:20:00Z'), end: T('2026-07-29T06:10:00Z'), handled: false, tag: 'infrastructure' },
  { resourceId: 'REQ-09', resourceType: 'request', runbookId: 'RB-003', start: T('2026-07-29T04:10:00Z'), end: T('2026-07-29T07:30:00Z'), handled: false, tag: 'infrastructure' },
  { resourceId: 'TKT-14', resourceType: 'ticket', runbookId: 'RB-002', start: T('2026-07-31T10:15:00Z'), end: T('2026-07-31T12:43:00Z'), handled: false, tag: 'configuration' },
  { resourceId: 'TKT-15', resourceType: 'ticket', runbookId: 'RB-002', start: T('2026-08-02T15:40:00Z'), end: T('2026-08-02T18:20:00Z'), handled: false, tag: 'configuration' },
  { resourceId: 'SVC-18', resourceType: 'service', runbookId: 'RB-001', start: T('2026-08-03T21:35:00Z'), end: T('2026-08-03T22:50:00Z'), handled: false, tag: 'data' },
  // The one episode that did produce a log — just outside tolerance.
  { resourceId: 'REQ-04', resourceType: 'request', runbookId: 'RB-003', start: T('2026-08-04T09:10:00Z'), end: T('2026-08-04T10:30:00Z'), handled: false, tag: 'detector-error', lateLogOffsetMinutes: 14 },
];

// ---------------------------------------------------------------------------
// Assemble.
// ---------------------------------------------------------------------------

const allEvents = [
  ...generatedEvents.map((e) => ({ ...e, ingestTimestamp: ingestFor(e.timestamp) })),
  ...plantedEvents,
].sort((a, b) => a.timestamp - b.timestamp || a.resourceId.localeCompare(b.resourceId));

export const events = allEvents.map((e, i) => ({
  eventId: `EV-${String(i + 1).padStart(4, '0')}`,
  resourceId: e.resourceId,
  resourceType: e.resourceType,
  state: e.state,
  timestamp: new Date(e.timestamp).toISOString(),
  ingestTimestamp: new Date(e.ingestTimestamp).toISOString(),
}));

// Intended trigger episodes. Consumed by executionLog.js so the log stays
// consistent with the event stream without re-deriving it through the detector.
export const episodes = [...generatedEpisodes, ...plantedEpisodes].sort(
  (a, b) => a.start - b.start,
);
