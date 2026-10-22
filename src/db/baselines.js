// Hand-written baseline detection SQL — one complete query per ASOP.
//
// This is the ground truth the generation stage gets diffed against, the same
// way the Generate tab diffs an extracted runbook definition against the
// configured one. A generated query is judged by whether it finds these misses,
// not by whether its text matches.
//
// EACH QUERY IS THE FULL DETECTION for its ASOP:
//
//   1. candidate evaluation, in that candidate type's own shape
//   2. its configs applied
//   3. its bypasses applied
//   4. anti-join against asop_activity_log, scoped by asop_id and keyed on the
//      json_extract path that its candidate type implies
//   5. returning the misses
//
// NOTHING IS SHARED BETWEEN THEM. There is no template, no helper that builds a
// duration expression, no common CTE. Seven candidate types with seven sets of
// time semantics do not factor, and a shared skeleton here would be a lie about
// the problem — it would make the resolution step the generation stage has to
// perform look unnecessary. Each block below stands alone and can be read
// without reference to any other.
//
// The one place that produces near-duplicate SQL is ASOP-114 and ASOP-118: same
// table, same shape, differing only in target state and threshold. They are
// supposed to look alike. That is the case that shows resolution cannot stop at
// "which table" — both queries are structurally identical and semantically
// different, and picking between them requires reading the condition.
//
// CONFIGS vs BYPASSES vs CONSTRICTIONS
//
//   A config is part of the condition. It decides what qualifies, and something
//   that fails it was never a candidate.
//
//   A bypass explains why nothing fired for a candidate that did qualify. It is
//   ATTRIBUTED ONTO THE ROW and never suppresses it — the gap still existed.
//   Same rule the original detector applies to exclusionList, and the reason
//   TKT-14 and TKT-15 appear in that report tagged rather than dropped.
//
//   A constriction is a BUSINESS SCOPING RULE — these departments, that
//   equipment class, this location prefix. Somebody decided it. It is not
//   derivable from the data and it is not arithmetic the query needs in order
//   to be correct; it is a boundary drawn around what the automation is
//   responsible for. Only ASOP-402 has one.
//
//   Not to be confused with the technical bounds several of these queries need:
//   closing an open interval at the end of the analysis window, taking the
//   latest event per batch and step, bounding on the window at all. Those are
//   correctness, not policy. They are declared under `configs`.
//
// THE ANTI-JOIN
//
// Identity-based, not tolerance-based. Every selection_payload carries enough
// to identify its candidate exactly, including the interval start for the
// time-shaped types, so there is no clock drift to widen for. `fired_at` is
// carried as evidence in some queries and is never used to match.
//
// Every join is scoped by asop_id as well as by the extracted key, because
// $.tool_id appears in port, tool AND check payloads and $.batch_id appears in
// batch AND hold payloads. The key alone over-matches.

// ===========================================================================
// ASOP-114 — Port Blocked Recovery
// ===========================================================================
//
// Shape: explicit intervals. Both edges are on the row, so the duration is a
// subtraction and needs no window function. A NULL exited_at means the port is
// still blocked, and the interval is closed at the end of the analysis window.

const ASOP_114_QUALIFYING = `
WITH qualifying AS (
  SELECT
    p.port_id,
    p.tool_id,
    p.entered_at,
    p.exited_at,
    p.port_mode,
    p.unit_present,
    (julianday(COALESCE(p.exited_at, $end)) - julianday(p.entered_at)) * 1440 AS blocked_minutes
  FROM port_state_history p
  WHERE p.state = 'blocked'
    AND (julianday(COALESCE(p.exited_at, $end)) - julianday(p.entered_at)) * 1440 > 30
)`;

const ASOP_114 = {
  asopId: 'ASOP-114',
  name: 'Port Blocked Recovery',
  sponsor: 'm.okonkwo',
  department: 'Ops Automation',
  table: 'port_state_history',
  shape: 'explicit intervals',
  condition:
    'A port sat in state = blocked for longer than the threshold. Duration is exited_at - entered_at; an open interval is closed at the end of the analysis window.',
  configs: {
    targetState: 'blocked',
    thresholdMinutes: 30,
    openIntervalsClosedAt: 'analysis end',
    // Revised down from 45, and the platform was updated at the time. Present
    // so that a threshold history is not by itself evidence of anything —
    // several ASOPs have one and only one of them went unapplied.
    thresholdHistory: [{ minutes: 45, revisedOn: '2026-04-18' }],
  },
  constrictions: [],
  bypasses: [
    {
      name: 'maintenance mode',
      clause: "port_mode = 'maint'",
      effect: 'attributed',
      note: 'A port under maintenance is not dispatched to. Explains the silence; the block still happened.',
    },
  ],
  antiJoinKeys: ['$.port_id', '$.entered_at'],
  params: ['$end'],

  sql: `${ASOP_114_QUALIFYING}
SELECT
  q.port_id,
  q.tool_id,
  q.entered_at,
  q.exited_at,
  ROUND(q.blocked_minutes) AS blocked_minutes,
  q.port_mode,
  CASE WHEN q.port_mode = 'maint' THEN 'port_mode = maint' END AS bypass,
  ps.status AS platform_status
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-114'
  AND json_extract(l.selection_payload, '$.port_id')    = q.port_id
  AND json_extract(l.selection_payload, '$.entered_at') = q.entered_at
LEFT JOIN platform_status ps
  ON  ps.window_start <= q.entered_at
  AND ps.window_end   >  q.entered_at
WHERE l.log_id IS NULL
ORDER BY q.entered_at`,

  coverageSql: `${ASOP_114_QUALIFYING}
SELECT
  COUNT(*)                                          AS qualifying,
  COUNT(l.log_id)                                   AS logged,
  -- COALESCE because SUM() over no rows is NULL, not 0.
  COALESCE(SUM(CASE WHEN l.log_id IS NULL THEN 1 ELSE 0 END), 0) AS missed
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-114'
  AND json_extract(l.selection_payload, '$.port_id')    = q.port_id
  AND json_extract(l.selection_payload, '$.entered_at') = q.entered_at`,
};

// ===========================================================================
// ASOP-118 — Port Error Escalation
// ===========================================================================
//
// Same table and same shape as ASOP-114, and deliberately not merged with it.
// A different target state and a tighter threshold: an error is escalated after
// 15 minutes where a block is given 30. Resolving documentation to this ASOP
// rather than ASOP-114 requires reading the condition, not the table name.

const ASOP_118_QUALIFYING = `
WITH qualifying AS (
  SELECT
    p.port_id,
    p.tool_id,
    p.entered_at,
    p.exited_at,
    p.port_mode,
    p.unit_present,
    (julianday(COALESCE(p.exited_at, $end)) - julianday(p.entered_at)) * 1440 AS error_minutes
  FROM port_state_history p
  WHERE p.state = 'error'
    AND (julianday(COALESCE(p.exited_at, $end)) - julianday(p.entered_at)) * 1440 > 15
)`;

const ASOP_118 = {
  asopId: 'ASOP-118',
  name: 'Port Error Escalation',
  sponsor: 'm.okonkwo',
  department: 'Ops Automation',
  table: 'port_state_history',
  shape: 'explicit intervals',
  condition:
    'A port sat in state = error for longer than the threshold. Same interval arithmetic as ASOP-114 against a different state, with a tighter threshold.',
  configs: {
    targetState: 'error',
    thresholdMinutes: 15,
    openIntervalsClosedAt: 'analysis end',
  },
  constrictions: [],
  bypasses: [
    {
      name: 'maintenance mode',
      clause: "port_mode = 'maint'",
      effect: 'attributed',
      note: 'Same bypass as ASOP-114, and it is the only thing these two share besides the table.',
    },
  ],
  antiJoinKeys: ['$.port_id', '$.entered_at'],
  params: ['$end'],

  sql: `${ASOP_118_QUALIFYING}
SELECT
  q.port_id,
  q.tool_id,
  q.entered_at,
  q.exited_at,
  ROUND(q.error_minutes) AS error_minutes,
  q.unit_present,
  CASE WHEN q.port_mode = 'maint' THEN 'port_mode = maint' END AS bypass,
  ps.status AS platform_status
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-118'
  AND json_extract(l.selection_payload, '$.port_id')    = q.port_id
  AND json_extract(l.selection_payload, '$.entered_at') = q.entered_at
LEFT JOIN platform_status ps
  ON  ps.window_start <= q.entered_at
  AND ps.window_end   >  q.entered_at
WHERE l.log_id IS NULL
ORDER BY q.entered_at`,

  coverageSql: `${ASOP_118_QUALIFYING}
SELECT
  COUNT(*)                                          AS qualifying,
  COUNT(l.log_id)                                   AS logged,
  -- COALESCE because SUM() over no rows is NULL, not 0.
  COALESCE(SUM(CASE WHEN l.log_id IS NULL THEN 1 ELSE 0 END), 0) AS missed
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-118'
  AND json_extract(l.selection_payload, '$.port_id')    = q.port_id
  AND json_extract(l.selection_payload, '$.entered_at') = q.entered_at`,
};

// ===========================================================================
// ASOP-207 — Queue Deadline Warning
// ===========================================================================
//
// Shape: countdown. Nothing here is an elapsed duration. The batch's state is
// spread across rows, so the current position has to be found first — the
// latest event per (batch_id, step_id) — and only then can the remaining time
// against that step's deadline be computed. It goes negative.
//
// This is the only baseline that needs a window function, and the only one
// where the qualifying quantity can be less than zero.

const ASOP_207_QUALIFYING = `
WITH positions AS (
  SELECT
    batch_id,
    step_id,
    event_type,
    event_at,
    queue_deadline,
    next_tool_group,
    ROW_NUMBER() OVER (
      PARTITION BY batch_id, step_id
      ORDER BY event_at DESC
    ) AS recency
  FROM batch_queue_events
),
qualifying AS (
  SELECT
    batch_id,
    step_id,
    event_type,
    event_at,
    queue_deadline,
    next_tool_group,
    (julianday(queue_deadline) - julianday(event_at)) * 1440 AS minutes_remaining
  FROM positions
  WHERE recency = 1
    AND event_type IN ('queued', 'in_transit')
    AND (julianday(queue_deadline) - julianday(event_at)) * 1440 < 60
)`;

const ASOP_207 = {
  asopId: 'ASOP-207',
  name: 'Queue Deadline Warning',
  sponsor: 'r.lindqvist',
  department: 'Logistics',
  table: 'batch_queue_events',
  shape: 'countdown to a deadline',
  condition:
    'At its most recent event, a batch still recorded as moving has less than the warning threshold left against that step\'s queue_deadline. Remaining time may be negative.',
  configs: {
    thresholdMinutesRemaining: 60,
    movingStates: ['queued', 'in_transit'],
    terminalStates: ['at_risk', 'expired'],
    position: 'latest event per (batch_id, step_id)',
  },
  constrictions: [],
  // Terminal states are a CONFIG, not a bypass: a batch the platform already
  // flagged was never a candidate for a warning. It does not get attributed
  // onto anything because it never qualifies in the first place.
  bypasses: [],
  antiJoinKeys: ['$.batch_id', '$.step_id', '$.queue_deadline'],
  params: [],

  sql: `${ASOP_207_QUALIFYING}
SELECT
  q.batch_id,
  q.step_id,
  q.event_type,
  q.event_at,
  q.queue_deadline,
  ROUND(q.minutes_remaining) AS minutes_remaining,
  q.next_tool_group,
  NULL AS bypass,
  ps.status AS platform_status
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-207'
  AND json_extract(l.selection_payload, '$.batch_id')       = q.batch_id
  AND json_extract(l.selection_payload, '$.step_id')        = q.step_id
  AND json_extract(l.selection_payload, '$.queue_deadline') = q.queue_deadline
LEFT JOIN platform_status ps
  ON  ps.window_start <= q.event_at
  AND ps.window_end   >  q.event_at
WHERE l.log_id IS NULL
ORDER BY q.queue_deadline`,

  coverageSql: `${ASOP_207_QUALIFYING}
SELECT
  COUNT(*)                                          AS qualifying,
  COUNT(l.log_id)                                   AS logged,
  -- COALESCE because SUM() over no rows is NULL, not 0.
  COALESCE(SUM(CASE WHEN l.log_id IS NULL THEN 1 ELSE 0 END), 0) AS missed
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-207'
  AND json_extract(l.selection_payload, '$.batch_id')       = q.batch_id
  AND json_extract(l.selection_payload, '$.step_id')        = q.step_id
  AND json_extract(l.selection_payload, '$.queue_deadline') = q.queue_deadline`,
};

// ===========================================================================
// ASOP-233 — Unplanned Tool Down Notify
// ===========================================================================
//
// Shape: unplanned windows. Interval arithmetic like the port ASOPs, but the
// duration test is not reached until planned work is removed. `scheduled = 1`
// is part of the condition and suppresses — a booked outage was never a
// candidate, including emergency work booked retrospectively.
//
// Contrast that with the bypass below, which does not suppress.

const ASOP_233_QUALIFYING = `
WITH qualifying AS (
  SELECT
    t.tool_id,
    t.status_start,
    t.status_end,
    t.reason_code,
    t.scheduled,
    (julianday(COALESCE(t.status_end, $end)) - julianday(t.status_start)) * 1440 AS down_minutes
  FROM tool_status_log t
  WHERE t.status = 'down'
    AND t.scheduled = 0
    AND (julianday(COALESCE(t.status_end, $end)) - julianday(t.status_start)) * 1440 > 30
)`;

const ASOP_233 = {
  asopId: 'ASOP-233',
  name: 'Unplanned Tool Down Notify',
  sponsor: 'p.varghese',
  department: 'Maintenance',
  table: 'tool_status_log',
  shape: 'unplanned windows',
  condition:
    'A tool was down, unscheduled, for longer than the threshold. status_end IS NULL means still down, closed at the end of the analysis window.',
  configs: {
    targetStatus: 'down',
    thresholdMinutes: 30,
    // Suppressing, unlike a bypass. Planned work is not a defect at any length.
    excludeScheduled: true,
    openIntervalsClosedAt: 'analysis end',
    // What this ASOP's threshold used to be. Metadata only — the query uses
    // thresholdMinutes and nothing here. Recorded because a downtime between
    // the superseded value and the current one is a candidate the platform
    // never saw if its own configuration was never updated, and there is no
    // way to tell that from the duration alone.
    thresholdHistory: [{ minutes: 60, revisedOn: '2026-05-14' }],
  },
  constrictions: [],
  bypasses: [
    {
      name: 'facility-wide event',
      clause: "reason_code = 'RC-FACILITY'",
      effect: 'attributed',
      note: 'Facility events are handled by a separate escalation path, so this ASOP stays quiet. The tool was still down and unscheduled.',
    },
  ],
  antiJoinKeys: ['$.tool_id', '$.status_start'],
  params: ['$end'],

  sql: `${ASOP_233_QUALIFYING}
SELECT
  q.tool_id,
  q.status_start,
  q.status_end,
  ROUND(q.down_minutes) AS down_minutes,
  q.reason_code,
  CASE WHEN q.reason_code = 'RC-FACILITY' THEN 'reason_code = RC-FACILITY' END AS bypass,
  ps.status AS platform_status
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-233'
  AND json_extract(l.selection_payload, '$.tool_id')      = q.tool_id
  AND json_extract(l.selection_payload, '$.status_start') = q.status_start
LEFT JOIN platform_status ps
  ON  ps.window_start <= q.status_start
  AND ps.window_end   >  q.status_start
WHERE l.log_id IS NULL
ORDER BY q.status_start`,

  coverageSql: `${ASOP_233_QUALIFYING}
SELECT
  COUNT(*)                                          AS qualifying,
  COUNT(l.log_id)                                   AS logged,
  -- COALESCE because SUM() over no rows is NULL, not 0.
  COALESCE(SUM(CASE WHEN l.log_id IS NULL THEN 1 ELSE 0 END), 0) AS missed
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-233'
  AND json_extract(l.selection_payload, '$.tool_id')      = q.tool_id
  AND json_extract(l.selection_payload, '$.status_start') = q.status_start`,
};

// ===========================================================================
// ASOP-341 — Hold Department Backfill
// ===========================================================================
//
// Shape: null check. There is no time dimension in this detection at all.
//
// No threshold. No duration. No analysis-window bound, so this query takes no
// $end parameter — the only baseline that does not. placed_at and released_at
// are real columns holding real times and appear nowhere in any predicate;
// they are selected as evidence only.
//
// There is deliberately no platform_status join either. Joining it would need a
// timestamp, and reaching for one here is exactly the mistake this candidate
// type exists to catch.
//
// This query cannot see holds whose dept_code is '' or '   ' rather than NULL.
// Three of those are in the data. They are the same defect and they are absent
// from this report by design — the counterpart of SVC-03 in src/data/. Widening
// this to TRIM(COALESCE(dept_code,'')) = '' would defeat the point.

const ASOP_341_QUALIFYING = `
WITH qualifying AS (
  SELECT
    h.hold_id,
    h.batch_id,
    h.hold_type,
    h.memo,
    h.placed_at,
    h.released_at
  FROM hold_records h
  WHERE h.dept_code IS NULL
)`;

const ASOP_341 = {
  asopId: 'ASOP-341',
  name: 'Hold Department Backfill',
  sponsor: 'a.ferreira',
  department: 'Quality',
  table: 'hold_records',
  shape: 'null check',
  condition:
    'A hold exists with no owning department. Every row in the table is evaluated; there is no window, no threshold and no duration.',
  configs: {
    nullColumn: 'dept_code',
    // Stated explicitly because their absence is the defining property here.
    thresholdMinutes: null,
    timePredicate: 'none',
  },
  constrictions: [],
  bypasses: [
    {
      name: 'engineering-owned hold',
      clause: "hold_type = 'engineering'",
      effect: 'attributed',
      note: 'Engineering holds are backfilled from the engineering queue instead. The hold is still unassigned here.',
    },
  ],
  antiJoinKeys: ['$.hold_id'],
  params: [],

  sql: `${ASOP_341_QUALIFYING}
SELECT
  q.hold_id,
  q.batch_id,
  q.hold_type,
  q.memo,
  q.placed_at,
  q.released_at,
  CASE WHEN q.hold_type = 'engineering' THEN 'hold_type = engineering' END AS bypass
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-341'
  AND json_extract(l.selection_payload, '$.hold_id') = q.hold_id
WHERE l.log_id IS NULL
ORDER BY q.hold_id`,

  coverageSql: `${ASOP_341_QUALIFYING}
SELECT
  COUNT(*)                                          AS qualifying,
  COUNT(l.log_id)                                   AS logged,
  -- COALESCE because SUM() over no rows is NULL, not 0.
  COALESCE(SUM(CASE WHEN l.log_id IS NULL THEN 1 ELSE 0 END), 0) AS missed
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-341'
  AND json_extract(l.selection_payload, '$.hold_id') = q.hold_id`,
};

// ===========================================================================
// ASOP-402 — Missed Check Sweep
// ===========================================================================
//
// Shape: absence. The defect is a missing counterpart, not a state a row is in.
// The row that proves it is the row that isn't there: ran_at IS NULL.
//
// The window bound is doing real work. A check due after the analysis window
// closes and not yet run is not a defect, and three of those are in the data.
//
// This is also the only baseline carrying a CONSTRICTION — a business scoping
// rule, as opposed to the window bound, which is arithmetic the query needs to
// be correct at all. The sweep covers the production bays and not the two
// pilot-line tools, because those sit under the vendor's service contract.
// Nobody derived that from the data; somebody decided it, and the only place it
// is written down is prose in TPL-CHECK-SWEEP.
//
// Two unrun, overdue, in-window checks sit on pilot tools (C-095, C-096). They
// are not candidates and never were. A generated query that misses the scoping
// rule returns them as two extra misses, which is exactly what makes this
// constriction testable rather than decorative.

const ASOP_402_QUALIFYING = `
WITH qualifying AS (
  SELECT
    c.check_id,
    c.tool_id,
    c.due_at,
    c.interval_minutes,
    c.skip_reason,
    (julianday($end) - julianday(c.due_at)) * 1440 AS minutes_overdue
  FROM scheduled_checks c
  WHERE c.ran_at IS NULL
    AND c.due_at < $end
    AND (julianday($end) - julianday(c.due_at)) * 1440 > 30
    AND c.tool_id BETWEEN 'T-01' AND 'T-22'
)`;

const ASOP_402 = {
  asopId: 'ASOP-402',
  name: 'Missed Check Sweep',
  sponsor: 'p.varghese',
  department: 'Quality Control',
  table: 'scheduled_checks',
  shape: 'absence',
  condition:
    'A scheduled check came due inside the analysis window, the grace period elapsed, and it never ran.',
  configs: {
    absentColumn: 'ran_at',
    graceMinutes: 30,
    windowBound: 'due_at < analysis end',
    // Halved by rev C of SOP-0402, and applied. Same point as ASOP-114's.
    thresholdHistory: [{ minutes: 60, revisedOn: '2025-11-01' }],
  },
  constrictions: [
    {
      name: 'production bays only',
      clause: "tool_id BETWEEN 'T-01' AND 'T-22'",
      note: 'The two pilot-line tools are swept by the vendor under their service contract. A scoping decision, not something the data implies.',
    },
  ],
  bypasses: [
    {
      name: 'recorded skip',
      clause: 'skip_reason IS NOT NULL',
      effect: 'attributed',
      note: 'The strict analogue of exclusionList in the original detector. A reason explains why the check went unrun; it does not make it run.',
    },
  ],
  antiJoinKeys: ['$.check_id'],
  params: ['$end'],

  sql: `${ASOP_402_QUALIFYING}
SELECT
  q.check_id,
  q.tool_id,
  q.due_at,
  ROUND(q.minutes_overdue) AS minutes_overdue,
  q.interval_minutes,
  CASE WHEN q.skip_reason IS NOT NULL THEN 'skip_reason: ' || q.skip_reason END AS bypass,
  ps.status AS platform_status
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-402'
  AND json_extract(l.selection_payload, '$.check_id') = q.check_id
LEFT JOIN platform_status ps
  ON  ps.window_start <= q.due_at
  AND ps.window_end   >  q.due_at
WHERE l.log_id IS NULL
ORDER BY q.due_at`,

  coverageSql: `${ASOP_402_QUALIFYING}
SELECT
  COUNT(*)                                          AS qualifying,
  COUNT(l.log_id)                                   AS logged,
  -- COALESCE because SUM() over no rows is NULL, not 0.
  COALESCE(SUM(CASE WHEN l.log_id IS NULL THEN 1 ELSE 0 END), 0) AS missed
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-402'
  AND json_extract(l.selection_payload, '$.check_id') = q.check_id`,
};

// ===========================================================================
// ASOP-455 — Notification Retry Escalation
// ===========================================================================
//
// Shape: retry chain. Qualification is a counter, not a clock. No interval, no
// deadline, no window bound — a message qualifies on `attempts` alone once the
// acknowledgement is missing.
//
// queued_at and sent_at are selected for evidence and are not in any predicate.
// sent_at IS NULL is not a filter either: a message that never left the queue
// still qualifies, and the row shows it.

const ASOP_455_QUALIFYING = `
WITH qualifying AS (
  SELECT
    e.message_id,
    e.recipient_group,
    e.queued_at,
    e.sent_at,
    e.attempts,
    e.bounce_code
  FROM email_queue e
  WHERE e.attempts > 3
    AND e.acked_at IS NULL
)`;

const ASOP_455 = {
  asopId: 'ASOP-455',
  name: 'Notification Retry Escalation',
  sponsor: 'r.lindqvist',
  department: 'Ops Automation',
  table: 'email_queue',
  shape: 'retry chain',
  condition:
    'A queued notification passed the retry ceiling and was never acknowledged. A long chain that was eventually acknowledged does not qualify.',
  configs: {
    attemptCeiling: 3,
    acknowledgementColumn: 'acked_at',
    timePredicate: 'none',
  },
  constrictions: [],
  bypasses: [
    {
      name: 'hard bounce',
      clause: "bounce_code = '550'",
      effect: 'attributed',
      note: 'The address is dead, so retrying cannot succeed and escalation was suppressed. The notification still never arrived.',
    },
  ],
  antiJoinKeys: ['$.message_id'],
  params: [],

  sql: `${ASOP_455_QUALIFYING}
SELECT
  q.message_id,
  q.recipient_group,
  q.attempts,
  q.queued_at,
  q.sent_at,
  q.bounce_code,
  CASE WHEN q.bounce_code = '550' THEN 'bounce_code = 550 (hard bounce)' END AS bypass
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-455'
  AND json_extract(l.selection_payload, '$.message_id') = q.message_id
WHERE l.log_id IS NULL
ORDER BY q.attempts DESC, q.message_id`,

  coverageSql: `${ASOP_455_QUALIFYING}
SELECT
  COUNT(*)                                          AS qualifying,
  COUNT(l.log_id)                                   AS logged,
  -- COALESCE because SUM() over no rows is NULL, not 0.
  COALESCE(SUM(CASE WHEN l.log_id IS NULL THEN 1 ELSE 0 END), 0) AS missed
FROM qualifying q
LEFT JOIN asop_activity_log l
  ON  l.asop_id = 'ASOP-455'
  AND json_extract(l.selection_payload, '$.message_id') = q.message_id`,
};

// ===========================================================================

export const BASELINES = [
  ASOP_114,
  ASOP_118,
  ASOP_207,
  ASOP_233,
  ASOP_341,
  ASOP_455,
  ASOP_402,
].sort((a, b) => a.asopId.localeCompare(b.asopId));

export const BASELINES_BY_ID = Object.fromEntries(
  BASELINES.map((baseline) => [baseline.asopId, baseline]),
);

/** Bind values for a baseline, filtered to the parameters its SQL declares. */
export function baselineParams(baseline, { analysisEnd }) {
  const available = { $end: analysisEnd };
  return Object.fromEntries(
    baseline.params.map((name) => [name, available[name]]),
  );
}
