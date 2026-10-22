// scheduled_checks — DETECTION SHAPE: absence.
//
// 120 scheduled checks. The defect is not a state a row is in, it is the
// absence of the row's counterpart:
//
//   WHERE due_at < :analysis_end AND ran_at IS NULL
//
// Nothing recorded the failure because nothing happened to record. The date
// predicate is doing real work here: three checks are due after the window
// closes and have not run, which is not yet a defect.
//
// skip_reason is the exclusion analogue. It explains why a check went unrun
// and is attributed onto the candidate; it does not make the check any less
// unrun, and it must never suppress the row.

import {
  ANALYSIS_END, DAY, HOUR, MIN, SEEDS, TOOL_IDS,
  WINDOW_START, between, iso, lcg, overlapsOutage, pick,
} from './common.js';

const rand = lcg(SEEDS.checks);

const INTERVALS = [60, 240, 480, 720, 1440, 10080];

const SKIP_REASONS = [
  'Tool in maintenance window',
  'Operator unavailable on shift',
  'Superseded by manual check',
  'Deferred by area lead',
];

// ---------------------------------------------------------------------------
// The interesting checks, keyed by roster position.
//
//   ranAt: null  never ran
//   skip         a reason was recorded, which explains but does not excuse
//   future       due after the window closes, so not yet a defect
//   outOfScope   never ran, and outside the sweep's scope, so not a defect
// ---------------------------------------------------------------------------

const SPECIAL_CHECKS = {
  3: { unrun: true, handled: true },
  11: { unrun: true, handled: true, skip: true },
  17: { unrun: true, handled: false, pinAt: '2026-07-29T02:10:00Z' },
  24: { unrun: true, handled: true },
  29: { unrun: true, handled: true, skip: true },
  // Missed AND bypassed: a reason was recorded, which explains the gap and
  // does not close it. The direct analogue of TKT-14/TKT-15 in src/data/.
  33: { unrun: true, handled: false, skip: true },
  38: { unrun: true, handled: true },
  45: { unrun: true, handled: true },
  49: { unrun: true, handled: false, pinAt: '2026-07-29T06:20:00Z' },
  54: { unrun: true, handled: true, skip: true },
  61: { unrun: true, handled: true },
  // Pinned out of the 07-23 morning window. It is an unexplained miss with no
  // shared cause, and leaving it beside cluster B would add a fourth finding
  // there that nothing in the data accounts for. Away from both clusters it is
  // what it should be: a singleton the diagnosis has to leave alone.
  67: { unrun: true, handled: false, pinAt: '2026-08-05T10:00:00Z' },
  72: { unrun: true, handled: true },
  79: { unrun: true, handled: true, skip: true },
  86: { unrun: true, handled: true },
  93: { unrun: true, handled: false, skip: true },
  101: { unrun: true, handled: true, skip: true },
  108: { unrun: true, handled: true },

  // Due after the analysis window closes. Unrun, and correctly not candidates.
  114: { unrun: true, future: true },
  117: { unrun: true, future: true },
  119: { unrun: true, future: true },

  // Unrun, overdue, inside the window — and on a pilot-line tool, which the
  // sweep does not cover. ASOP-402 is scoped to the production bays (T-01
  // through T-22) because the two pilot tools sit under the vendor's service
  // contract and the vendor books and chases their checks.
  //
  // Same mechanism as `future` above: a real row that is correctly not a
  // candidate, so the totals do not move. What it is FOR is different. The
  // window bound is arithmetic the query needs to be correct at all; this is a
  // business scoping rule someone decided, and the only place it is written
  // down is prose in TPL-CHECK-SWEEP. A generated query that fails to find it
  // returns these two rows as extra misses, and scoring says so.
  //
  // Positions 94 and 95 already land on T-23 and T-24 through the i % 24 tool
  // cycle, so nothing here overrides a tool. `outOfScope` deliberately does not
  // set `unrun`: ran_at is nulled below AFTER the draw, so the generator
  // consumes exactly the same numbers it did before and no other row moves.
  94: { outOfScope: true },
  95: { outOfScope: true },
};

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

const rows = [];
const candidates = [];

for (let i = 0; i < 120; i += 1) {
  const checkId = `C-${String(i + 1).padStart(3, '0')}`;
  const toolId = TOOL_IDS[i % TOOL_IDS.length];
  const special = SPECIAL_CHECKS[i];

  let dueAt;
  if (special?.pinAt) {
    dueAt = Date.parse(special.pinAt);
  } else if (special?.future) {
    dueAt = ANALYSIS_END + between(rand, 2, 40) * HOUR;
  } else {
    dueAt =
      WINDOW_START +
      between(rand, 0, 13) * DAY +
      between(rand, 0, 23) * HOUR +
      between(rand, 0, 59) * MIN;
  }

  // A check that ran, ran a little after it was due.
  const ranAt = special?.unrun ? null : dueAt + between(rand, 0, 25) * MIN;
  const skipReason = special?.skip ? pick(rand, SKIP_REASONS) : null;

  // Nulled here rather than through `unrun` so the draw above still happens.
  const neverRan = special?.unrun === true || special?.outOfScope === true;

  rows.push({
    check_id: checkId,
    tool_id: toolId,
    due_at: iso(dueAt),
    ran_at: neverRan ? null : iso(ranAt),
    interval_minutes: pick(rand, INTERVALS),
    skip_reason: skipReason,
  });

  if (!special?.unrun || special.future) continue;

  candidates.push({
    table: 'scheduled_checks',
    asopId: 'ASOP-402',
    handled: special.handled === true,
    payload: {
      check_id: checkId,
      tool_id: toolId,
      due_at: iso(dueAt),
    },
    actionableAt: dueAt,
    intervalStart: dueAt,
    intervalEnd: dueAt,
    insideOutage: overlapsOutage(dueAt, dueAt + 30 * MIN),
    // Recorded on the candidate, never used to drop it.
    excludedBy: skipReason,
  });
}

export const scheduledChecks = rows;
export const checkCandidates = candidates;
