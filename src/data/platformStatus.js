// Availability of the automation platform itself across the analysis window.
//
// The platform is event-driven with no historical replay. While it is down,
// trigger conditions come and go unobserved and leave no record anywhere in the
// system that failed — which is exactly the blind spot the audit layer covers.

export const platformStatus = [
  {
    windowId: 'PW-001',
    status: 'up',
    start: '2026-07-23T00:00:00Z',
    end: '2026-07-26T03:30:00Z',
    note: 'Nominal.',
  },
  {
    windowId: 'PW-002',
    status: 'degraded',
    start: '2026-07-26T03:30:00Z',
    end: '2026-07-26T05:10:00Z',
    note: 'Event ingestion lag elevated; scheduler unaffected.',
  },
  {
    windowId: 'PW-003',
    status: 'up',
    start: '2026-07-26T05:10:00Z',
    end: '2026-07-29T02:00:00Z',
    note: 'Nominal.',
  },
  {
    windowId: 'PW-004',
    status: 'down',
    start: '2026-07-29T02:00:00Z',
    end: '2026-07-29T08:00:00Z',
    note: 'Unplanned outage. Orchestrator cluster offline for 6h. No event replay on recovery.',
  },
  {
    windowId: 'PW-005',
    status: 'up',
    start: '2026-07-29T08:00:00Z',
    end: '2026-08-02T23:00:00Z',
    note: 'Nominal.',
  },
  {
    windowId: 'PW-006',
    status: 'degraded',
    start: '2026-08-02T23:00:00Z',
    end: '2026-08-03T00:15:00Z',
    note: 'Partial worker pool restart during patch rollout.',
  },
  {
    windowId: 'PW-007',
    status: 'up',
    start: '2026-08-03T00:15:00Z',
    end: '2026-08-06T00:00:00Z',
    note: 'Nominal.',
  },
];

const MS = (iso) => Date.parse(iso);

/** Distinct platform states overlapping [start, end), worst-first. */
export function statusDuring(start, end) {
  const severity = { down: 3, degraded: 2, up: 1 };
  const overlapping = platformStatus.filter(
    (w) => MS(w.start) < end && MS(w.end) > start,
  );
  const seen = new Map();
  for (const w of overlapping) {
    if (!seen.has(w.status)) seen.set(w.status, w);
  }
  return [...seen.values()].sort(
    (a, b) => severity[b.status] - severity[a.status],
  );
}

/** Fraction of the analysis window during which the platform was fully up. */
export function uptimeRatio(windowStart, windowEnd) {
  let up = 0;
  for (const w of platformStatus) {
    if (w.status !== 'up') continue;
    const s = Math.max(MS(w.start), windowStart);
    const e = Math.min(MS(w.end), windowEnd);
    if (e > s) up += e - s;
  }
  return up / (windowEnd - windowStart);
}
