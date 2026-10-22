// Schema for the in-browser SQLite database.
//
// Six candidate tables, each holding a different kind of thing an automation
// can target, each with a different shape of defect. They are deliberately NOT
// one table renamed six times: the columns differ, the time semantics differ,
// and two of them have no time dimension in their detection logic at all.
//
// Resolving *which* of these a piece of documentation describes is the job of
// the generation stage. A single generic detector cannot cover them, which is
// the entire point of the exercise.
//
// CONVENTIONS
//
// Timestamps  TEXT, ISO-8601 UTC, 'YYYY-MM-DDTHH:MM:SSZ', always 20 characters.
//             Fixed width means lexicographic order is chronological order, so
//             plain string comparison is a valid range filter. Durations come
//             from (julianday(b) - julianday(a)) * 1440, in minutes.
// Booleans    INTEGER 0/1 with a CHECK. SQLite has no boolean type.
// Enums       TEXT with a CHECK, so a bad seed fails at insert rather than
//             silently producing a row no detector will ever match.
// NULL        Means the thing genuinely did not happen — never the empty
//             string. Three tables make this load-bearing.

export const DDL = [
  // -------------------------------------------------------------------------
  // 1. EXPLICIT INTERVALS
  //
  // A port moves through states and each row records one occupancy with
  // both edges. Duration is on the row: exited_at - entered_at. This is the
  // only shape that resembles the original event-pair detector.
  //
  // exited_at IS NULL means the port is still in that state at analysis end.
  // -------------------------------------------------------------------------
  `CREATE TABLE port_state_history (
     port_id         TEXT    NOT NULL,
     tool_id         TEXT    NOT NULL,
     state           TEXT    NOT NULL CHECK (state IN ('idle','loading','unloading','blocked','error')),
     entered_at      TEXT    NOT NULL,
     exited_at       TEXT,
     unit_present INTEGER NOT NULL CHECK (unit_present IN (0,1)),
     port_mode       TEXT    NOT NULL CHECK (port_mode IN ('auto','manual','maint')),
     PRIMARY KEY (port_id, entered_at)
   )`,

  // -------------------------------------------------------------------------
  // 2. COUNTDOWN TO A DEADLINE
  //
  // Not elapsed duration. Each (batch_id, step_id) carries a queue_deadline,
  // and what matters is the time REMAINING against it at the batch's most
  // recent event: queue_deadline - event_at, which may be negative.
  //
  // A batch is only exposed if it is still moving. 'at_risk' and 'expired' are
  // terminal — the platform already knows about those, so they are not
  // candidates however far past the deadline they sit.
  // -------------------------------------------------------------------------
  `CREATE TABLE batch_queue_events (
     batch_id        TEXT NOT NULL,
     step_id         TEXT NOT NULL,
     event_type      TEXT NOT NULL CHECK (event_type IN ('queued','in_transit','at_risk','expired')),
     event_at        TEXT NOT NULL,
     queue_deadline  TEXT NOT NULL,
     next_tool_group TEXT,
     PRIMARY KEY (batch_id, step_id, event_at)
   )`,

  // -------------------------------------------------------------------------
  // 3. UNPLANNED WINDOWS
  //
  // Interval-shaped like the ports table, but the qualifying condition is not
  // just duration — planned work has to come out first. scheduled = 1 covers
  // booked maintenance, including emergency work that was booked after the
  // fact, and none of it is a defect.
  //
  // status_end IS NULL means the tool is still in that status at analysis end.
  // reason_code is NULL for 'up'.
  // -------------------------------------------------------------------------
  `CREATE TABLE tool_status_log (
     tool_id      TEXT    NOT NULL,
     status       TEXT    NOT NULL CHECK (status IN ('up','down','pm','test')),
     status_start TEXT    NOT NULL,
     status_end   TEXT,
     reason_code  TEXT,
     scheduled    INTEGER NOT NULL CHECK (scheduled IN (0,1)),
     PRIMARY KEY (tool_id, status_start)
   )`,

  // -------------------------------------------------------------------------
  // 4. NULL CHECK — no time dimension whatsoever
  //
  // The defect is a hold booked without a owning department. There is no
  // duration, no threshold, and no window: every row in the table is evaluated
  // and the condition is dept_code IS NULL. placed_at and released_at exist
  // and are real, and detection ignores both.
  //
  // Correct SQL for this candidate type contains no time predicate at all.
  // -------------------------------------------------------------------------
  `CREATE TABLE hold_records (
     hold_id     TEXT NOT NULL PRIMARY KEY,
     batch_id    TEXT NOT NULL,
     placed_at   TEXT NOT NULL,
     released_at TEXT,
     dept_code   TEXT,
     memo        TEXT,
     hold_type   TEXT NOT NULL CHECK (hold_type IN ('quality','engineering','material','customer'))
   )`,

  // -------------------------------------------------------------------------
  // 5. ABSENCE
  //
  // The defect is the absence of a row's counterpart, not the presence of a
  // state: due_at has passed and ran_at IS NULL. Nothing recorded the failure
  // because nothing happened to record.
  //
  // skip_reason is the exclusion analogue. It explains why a check was not
  // run; it does not make the check any less unrun.
  // -------------------------------------------------------------------------
  `CREATE TABLE scheduled_checks (
     check_id         TEXT    NOT NULL PRIMARY KEY,
     tool_id          TEXT    NOT NULL,
     due_at           TEXT    NOT NULL,
     ran_at           TEXT,
     interval_minutes INTEGER NOT NULL,
     skip_reason      TEXT
   )`,

  // -------------------------------------------------------------------------
  // 6. RETRY CHAIN
  //
  // Qualification is a counter, not a clock: attempts past the retry ceiling
  // with no acknowledgement. A message that took six attempts and was finally
  // acked is not a defect, and one that was never sent at all still is.
  // -------------------------------------------------------------------------
  `CREATE TABLE email_queue (
     message_id      TEXT    NOT NULL PRIMARY KEY,
     recipient_group TEXT    NOT NULL,
     queued_at       TEXT    NOT NULL,
     sent_at         TEXT,
     acked_at        TEXT,
     attempts        INTEGER NOT NULL,
     bounce_code     TEXT
   )`,

  // -------------------------------------------------------------------------
  // SUPPORTING: the automation platform's own activity log.
  //
  // This is a real system log and it has no clean candidate_type column. What
  // it has is selection_payload — the literal columns and values the
  // automation grabbed while selecting its candidate — so the SHAPE of the
  // JSON differs per candidate type:
  //
  //   port   {"port_id","tool_id","state","entered_at"}
  //   batch  {"batch_id","step_id","queue_deadline"}
  //   tool   {"tool_id","status","status_start","reason_code"}
  //   hold   {"hold_id","batch_id","dept_code":null,"memo"}
  //   check  {"check_id","tool_id","due_at"}
  //   email  {"message_id","recipient_group","attempts"}
  //
  // Anti-joining a candidate to this log therefore needs
  // json_extract(selection_payload, '$.<key>') where the key depends on the
  // resolved candidate type. Two keys are ambiguous on their own:
  //
  //   $.tool_id   appears in port, tool AND check payloads
  //   $.batch_id  appears in batch AND hold payloads
  //
  // so the join must also be scoped by asop_id. Extracting the right key is
  // not sufficient.
  //
  // CRITICAL: this table contains only candidates that were successfully
  // picked up. A missed candidate has NO ROW HERE AT ALL — that absence is
  // the whole premise. There are no rows representing failures to detect.
  //
  // outcome is recorded and deliberately unused: this pass measures candidate
  // SELECTION, not execution. An automation that fired and then failed still
  // selected its candidate correctly.
  // -------------------------------------------------------------------------
  `CREATE TABLE asop_activity_log (
     log_id            TEXT NOT NULL PRIMARY KEY,
     asop_id           TEXT NOT NULL,
     asop_name         TEXT NOT NULL,
     sponsor           TEXT NOT NULL,
     department        TEXT NOT NULL,
     fired_at          TEXT NOT NULL,
     outcome           TEXT NOT NULL CHECK (outcome IN ('success','failed','partial')),
     selection_payload TEXT NOT NULL
   )`,

  // -------------------------------------------------------------------------
  // SUPPORTING: availability of the automation platform itself.
  // -------------------------------------------------------------------------
  `CREATE TABLE platform_status (
     window_id    TEXT NOT NULL PRIMARY KEY,
     status       TEXT NOT NULL CHECK (status IN ('up','degraded','down')),
     window_start TEXT NOT NULL,
     window_end   TEXT NOT NULL,
     note         TEXT
   )`,

  // -------------------------------------------------------------------------
  // 9-10. STATIONS AND HANDOFFS
  //
  // Context tables, not audit candidates: no automated procedure watches them
  // yet. They give the batches a route through the network (seq 1..6, with two
  // parallel lanes at seq 3) so that later layers can measure each station and
  // compare stations that are supposed to behave alike.
  //
  // station_visits    one row per batch per station: arrived_at, departed_at.
  //                   Dwell is departed_at - arrived_at.
  // station_handoffs  one row per station-to-station move: departed_at from the
  //                   upstream station, arrived_at at the downstream one. The
  //                   gap is transit/queue time between stations.
  // -------------------------------------------------------------------------
  `CREATE TABLE stations (
     station_id TEXT NOT NULL PRIMARY KEY,
     name       TEXT NOT NULL,
     seq        INTEGER NOT NULL,
     lane       TEXT
   )`,

  `CREATE TABLE station_visits (
     batch_id    TEXT NOT NULL,
     station_id  TEXT NOT NULL REFERENCES stations (station_id),
     arrived_at  TEXT NOT NULL,
     departed_at TEXT NOT NULL,
     PRIMARY KEY (batch_id, station_id)
   )`,

  `CREATE TABLE station_handoffs (
     batch_id     TEXT NOT NULL,
     from_station TEXT NOT NULL REFERENCES stations (station_id),
     to_station   TEXT NOT NULL REFERENCES stations (station_id),
     departed_at  TEXT NOT NULL,
     arrived_at   TEXT NOT NULL,
     PRIMARY KEY (batch_id, from_station, to_station)
   )`,

  // -------------------------------------------------------------------------
  // 11-12. MEASUREMENTS FOR PROCESS CONTROL
  //
  // station_specs      one metric per station with its spec limits.
  // station_measurements  readings in rational subgroups of 5 (consecutive
  //                    units), the shape an X-bar/R chart assumes.
  // -------------------------------------------------------------------------
  `CREATE TABLE station_specs (
     station_id TEXT NOT NULL PRIMARY KEY REFERENCES stations (station_id),
     metric     TEXT NOT NULL,
     unit       TEXT NOT NULL,
     lsl        REAL NOT NULL,
     usl        REAL NOT NULL,
     target     REAL NOT NULL
   )`,

  `CREATE TABLE station_measurements (
     station_id  TEXT    NOT NULL REFERENCES stations (station_id),
     subgroup    INTEGER NOT NULL,
     seq         INTEGER NOT NULL,
     measured_at TEXT    NOT NULL,
     value       REAL    NOT NULL,
     PRIMARY KEY (station_id, subgroup, seq)
   )`,

  // Indexes on the columns the anti-join actually drives from.
  `CREATE INDEX idx_port_state       ON port_state_history (state, entered_at)`,
  `CREATE INDEX idx_batch_group      ON batch_queue_events (batch_id, step_id, event_at)`,
  `CREATE INDEX idx_tool_status      ON tool_status_log (status, scheduled)`,
  `CREATE INDEX idx_hold_dept        ON hold_records (dept_code)`,
  `CREATE INDEX idx_checks_due       ON scheduled_checks (due_at, ran_at)`,
  `CREATE INDEX idx_email_attempts   ON email_queue (attempts, acked_at)`,
  `CREATE INDEX idx_asop_lookup      ON asop_activity_log (asop_id, fired_at)`,
];

// Column order per table, used to build the INSERT statements. Kept next to the
// DDL so the two cannot drift apart.
export const TABLE_COLUMNS = {
  port_state_history: ['port_id', 'tool_id', 'state', 'entered_at', 'exited_at', 'unit_present', 'port_mode'],
  batch_queue_events: ['batch_id', 'step_id', 'event_type', 'event_at', 'queue_deadline', 'next_tool_group'],
  tool_status_log: ['tool_id', 'status', 'status_start', 'status_end', 'reason_code', 'scheduled'],
  hold_records: ['hold_id', 'batch_id', 'placed_at', 'released_at', 'dept_code', 'memo', 'hold_type'],
  scheduled_checks: ['check_id', 'tool_id', 'due_at', 'ran_at', 'interval_minutes', 'skip_reason'],
  email_queue: ['message_id', 'recipient_group', 'queued_at', 'sent_at', 'acked_at', 'attempts', 'bounce_code'],
  asop_activity_log: ['log_id', 'asop_id', 'asop_name', 'sponsor', 'department', 'fired_at', 'outcome', 'selection_payload'],
  stations: ['station_id', 'name', 'seq', 'lane'],
  station_visits: ['batch_id', 'station_id', 'arrived_at', 'departed_at'],
  station_handoffs: ['batch_id', 'from_station', 'to_station', 'departed_at', 'arrived_at'],
  station_specs: ['station_id', 'metric', 'unit', 'lsl', 'usl', 'target'],
  station_measurements: ['station_id', 'subgroup', 'seq', 'measured_at', 'value'],
  platform_status: ['window_id', 'status', 'window_start', 'window_end', 'note'],
};

// What each candidate table looks like to a detector. This is descriptive
// metadata for the generation stage to resolve against — it does not drive any
// query by itself.
export const CANDIDATE_TABLES = {
  port_state_history: {
    shape: 'interval',
    key: ['port_id', 'entered_at'],
    payloadKey: 'port_id',
    summary: 'Explicit intervals. Duration is exited_at - entered_at, with NULL meaning still open at analysis end.',
  },
  batch_queue_events: {
    shape: 'countdown',
    key: ['batch_id', 'step_id'],
    payloadKey: 'batch_id',
    summary: 'Countdown. Time remaining is queue_deadline - event_at at the latest event per batch/step, and may be negative.',
  },
  tool_status_log: {
    shape: 'unplanned-window',
    key: ['tool_id', 'status_start'],
    payloadKey: 'tool_id',
    summary: "Interval, but planned work is not a defect: scheduled = 1 is excluded before duration is considered.",
  },
  hold_records: {
    shape: 'null-check',
    key: ['hold_id'],
    payloadKey: 'hold_id',
    summary: 'Null check. dept_code IS NULL. No duration, no threshold, no time predicate of any kind.',
  },
  scheduled_checks: {
    shape: 'absence',
    key: ['check_id'],
    payloadKey: 'check_id',
    summary: 'Absence. due_at has passed and ran_at IS NULL. The defect is a missing counterpart, not a state.',
  },
  email_queue: {
    shape: 'retry-chain',
    key: ['message_id'],
    payloadKey: 'message_id',
    summary: 'Retry chain. attempts past the ceiling with acked_at IS NULL. A counter, not a clock.',
  },
};
