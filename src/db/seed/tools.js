// tool_status_log — DETECTION SHAPE: unplanned downtime windows.
//
// Interval-shaped like the ports table, but duration is not the whole story:
// planned work has to come out first. `scheduled = 1` covers booked
// maintenance, including emergency work that got booked after the fact, and
// none of it is a defect however long it ran.
//
// Two traps live here on purpose:
//   - 'down' rows with scheduled = 1 (emergency work, booked retrospectively).
//     Long, unpleasant, and correctly excluded.
//   - 'pm' rows with scheduled = 0 (maintenance nobody booked). Unplanned, but
//     not downtime, so ASOP-233's status filter passes over them.
//
// status_end IS NULL means the tool is still in that status at analysis end.

import {
  ANALYSIS_END, HOUR, MIN, OUTAGE, SEEDS, TOOL_IDS,
  WINDOW_START, between, iso, lcg, overlapsOutage,
} from './common.js';

const rand = lcg(SEEDS.tools);

/** Minutes of unplanned downtime above which ASOP-233 wants the tool flagged. */
export const DOWNTIME_THRESHOLD_MINUTES = 30;

// ---------------------------------------------------------------------------
// Episodes per tool, in order. Everything between them is 'up'.
//
// `handled` is null for anything that is not a candidate: wrong status,
// scheduled work, or under the threshold.
// ---------------------------------------------------------------------------

const TOOL_EPISODES = {
  'T-01': [{ status: 'down', minutes: 95, scheduled: 0, reason: 'RC-ALARM', handled: true }],
  'T-02': [{ status: 'down', minutes: 47, scheduled: 0, reason: 'RC-PARTS', handled: true }],
  'T-03': [{ status: 'pm', minutes: 180, scheduled: 1, reason: 'RC-PM', handled: null }],
  'T-04': [{ status: 'down', minutes: 210, scheduled: 0, reason: 'RC-ALARM', handled: false, pinAt: '2026-07-29T02:25:00Z' }],
  'T-05': [{ status: 'down', minutes: 62, scheduled: 0, reason: 'RC-FACILITY', handled: true }],
  'T-06': [{ status: 'test', minutes: 240, scheduled: 1, reason: 'RC-TEST', handled: null }],
  'T-07': [{ status: 'down', minutes: 38, scheduled: 0, reason: 'RC-PARTS', handled: true }],
  'T-08': [{ status: 'down', minutes: 22, scheduled: 0, reason: 'RC-ALARM', handled: null }],
  // Pinned clear of both clusters. It is a bypassed miss (RC-FACILITY) and its
  // cause is its own bypass, so leaving it inside the 07-23 morning window
  // would put a fourth, unrelated finding into cluster B.
  'T-09': [{ status: 'down', minutes: 130, scheduled: 0, reason: 'RC-FACILITY', handled: false, pinAt: '2026-08-04T14:05:00Z' }],
  'T-10': [{ status: 'pm', minutes: 90, scheduled: 1, reason: 'RC-PM', handled: null }],
  'T-11': [{ status: 'down', minutes: 55, scheduled: 0, reason: 'RC-ALARM', handled: true }],
  // Still down when the window closes: status_end IS NULL on a candidate, so
  // ASOP-233's COALESCE(status_end, $end) has something to close. This used to
  // be T-23, which is now the stale-threshold case in cluster B; the property
  // moved here rather than being spent. Pinned after the outage so an episode
  // running to analysis end does not span it.
  'T-12': [{ status: 'down', minutes: null, scheduled: 0, reason: 'RC-PARTS', handled: true, open: true, pinAt: '2026-08-04T09:00:00Z' }],
  // Maintenance nobody booked. Unplanned, but not downtime.
  'T-13': [{ status: 'pm', minutes: 45, scheduled: 0, reason: 'RC-PM', handled: null }],
  // Emergency repair, booked into the schedule after the fact. Excluded.
  'T-14': [{ status: 'down', minutes: 78, scheduled: 1, reason: 'RC-PARTS', handled: null }],
  'T-15': [{ status: 'down', minutes: 41, scheduled: 0, reason: 'RC-CAL', handled: true }],
  'T-16': [{ status: 'test', minutes: 300, scheduled: 1, reason: 'RC-TEST', handled: null }],
  'T-17': [{ status: 'down', minutes: 18, scheduled: 0, reason: 'RC-ALARM', handled: null }],
  'T-18': [{ status: 'down', minutes: 88, scheduled: 0, reason: 'RC-FACILITY', handled: true }],

  'T-19': [
    { status: 'pm', minutes: 120, scheduled: 1, reason: 'RC-PM', handled: null },
    { status: 'down', minutes: 52, scheduled: 0, reason: 'RC-ALARM', handled: true },
  ],
  'T-20': [
    { status: 'down', minutes: 27, scheduled: 0, reason: 'RC-PARTS', handled: null },
    { status: 'down', minutes: 145, scheduled: 0, reason: 'RC-ALARM', handled: false, pinAt: '2026-07-29T03:40:00Z' },
  ],
  'T-21': [
    { status: 'test', minutes: 180, scheduled: 1, reason: 'RC-TEST', handled: null },
    { status: 'down', minutes: 63, scheduled: 0, reason: 'RC-CAL', handled: true },
  ],
  'T-22': [
    { status: 'down', minutes: 96, scheduled: 1, reason: 'RC-FACILITY', handled: null },
    { status: 'down', minutes: 44, scheduled: 0, reason: 'RC-PARTS', handled: true },
  ],
  // CLUSTER B — stale threshold. 38 minutes of unplanned downtime: over
  // ASOP-233's current 30-minute threshold, under the 60 it was revised down
  // from. The platform is still configured at the superseded value, so it never
  // qualified there and nothing fired. Nothing is wrong with the platform and
  // no outage is involved — the fix is to update the threshold.
  //
  // The down episode is first and pinned so the 'up' row before it runs from
  // the window start; an unpinned episode ahead of it would collide.
  'T-23': [
    { status: 'down', minutes: 38, scheduled: 0, reason: 'RC-ALARM', handled: false, pinAt: '2026-07-23T09:20:00Z' },
    { status: 'pm', minutes: 60, scheduled: 1, reason: 'RC-PM', handled: null },
  ],
  'T-24': [
    { status: 'down', minutes: 33, scheduled: 0, reason: 'RC-CAL', handled: true },
    { status: 'pm', minutes: 150, scheduled: 0, reason: 'RC-PM', handled: null },
  ],
};

const isCandidate = (episode, endMs, startMs) =>
  episode.status === 'down' &&
  episode.scheduled === 0 &&
  (endMs - startMs) / MIN > DOWNTIME_THRESHOLD_MINUTES;

// ---------------------------------------------------------------------------
// Build. Each tool is one contiguous chain: 'up' everywhere except its
// episodes, with the final row left open.
// ---------------------------------------------------------------------------

const rows = [];
const candidates = [];

for (const toolId of TOOL_IDS) {
  const episodes = TOOL_EPISODES[toolId] ?? [];
  let cursor = WINDOW_START;
  let endsOpen = false;

  episodes.forEach((episode) => {
    let start = episode.pinAt
      ? Date.parse(episode.pinAt)
      : cursor + between(rand, 6, 60) * HOUR + between(rand, 0, 59) * MIN;

    // Nothing could have been picked up while the platform was down, so a
    // handled episode is placed clear of the outage rather than inside it.
    if (episode.handled === true && overlapsOutage(start, start + (episode.minutes ?? 0) * MIN)) {
      start = OUTAGE.end + 30 * MIN;
    }

    const end = episode.open ? null : start + episode.minutes * MIN;
    // The roster is literal, so a layout that no longer fits is a seed bug and
    // should stop the build rather than quietly drop a case.
    if (end !== null && end > ANALYSIS_END - 2 * HOUR) {
      throw new Error(`tool_status_log: ${toolId} episode overruns the analysis window`);
    }

    rows.push({
      tool_id: toolId,
      status: 'up',
      status_start: iso(cursor),
      status_end: iso(start),
      reason_code: null, // 'up' has no reason
      scheduled: 0,
    });
    rows.push({
      tool_id: toolId,
      status: episode.status,
      status_start: iso(start),
      status_end: end === null ? null : iso(end),
      reason_code: episode.reason,
      scheduled: episode.scheduled,
    });

    const effectiveEnd = end ?? ANALYSIS_END;
    if (isCandidate(episode, effectiveEnd, start)) {
      candidates.push({
        table: 'tool_status_log',
        asopId: 'ASOP-233',
        handled: episode.handled === true,
        payload: {
          tool_id: toolId,
          status: episode.status,
          status_start: iso(start),
          reason_code: episode.reason,
        },
        actionableAt: start + DOWNTIME_THRESHOLD_MINUTES * MIN,
        intervalStart: start,
        intervalEnd: effectiveEnd,
        insideOutage: overlapsOutage(start, effectiveEnd),
      });
    }

    if (end === null) {
      endsOpen = true;
      return;
    }
    cursor = end;
  });

  // Back up, and still there when the window closes.
  if (!endsOpen) {
    rows.push({
      tool_id: toolId,
      status: 'up',
      status_start: iso(cursor),
      status_end: null,
      reason_code: null,
      scheduled: 0,
    });
  }
}

export const toolStatusLog = rows.sort(
  (a, b) =>
    a.tool_id.localeCompare(b.tool_id) || a.status_start.localeCompare(b.status_start),
);

export const toolCandidates = candidates;
