// platform_status — availability of the automation platform itself.
//
// The platform is event-driven and performs no historical replay. While it is
// down, conditions open and close unobserved and leave no record anywhere in
// the system that failed. The six-hour outage on 2026-07-29 is the same one
// the original event-based dataset uses, so the two layers tell one story.

export const platformStatusWindows = [
  {
    window_id: 'PW-001',
    status: 'up',
    window_start: '2026-07-23T00:00:00Z',
    window_end: '2026-07-26T03:30:00Z',
    note: 'Nominal.',
  },
  {
    window_id: 'PW-002',
    status: 'degraded',
    window_start: '2026-07-26T03:30:00Z',
    window_end: '2026-07-26T05:10:00Z',
    note: 'Candidate selection lag elevated; dispatcher unaffected.',
  },
  {
    window_id: 'PW-003',
    status: 'up',
    window_start: '2026-07-26T05:10:00Z',
    window_end: '2026-07-29T02:00:00Z',
    note: 'Nominal.',
  },
  {
    window_id: 'PW-004',
    status: 'down',
    window_start: '2026-07-29T02:00:00Z',
    window_end: '2026-07-29T08:00:00Z',
    note: 'Unplanned outage. Orchestrator cluster offline for 6h. No replay of missed candidates on recovery.',
  },
  {
    window_id: 'PW-005',
    status: 'up',
    window_start: '2026-07-29T08:00:00Z',
    window_end: '2026-08-02T23:00:00Z',
    note: 'Nominal.',
  },
  {
    window_id: 'PW-006',
    status: 'degraded',
    window_start: '2026-08-02T23:00:00Z',
    window_end: '2026-08-03T00:15:00Z',
    note: 'Partial worker pool restart during patch rollout.',
  },
  {
    window_id: 'PW-007',
    status: 'up',
    window_start: '2026-08-03T00:15:00Z',
    window_end: '2026-08-06T00:00:00Z',
    note: 'Nominal.',
  },
];
