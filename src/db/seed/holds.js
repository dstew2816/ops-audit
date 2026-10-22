// hold_records — DETECTION SHAPE: null check. No time dimension at all.
//
// 84 holds. The defect is a hold booked without an owning department, and the
// entire qualifying condition is:
//
//   WHERE dept_code IS NULL
//
// No duration. No threshold. No window. placed_at and released_at are real
// columns holding real times and detection ignores both of them — correct SQL
// for this candidate type contains no time predicate whatsoever. They are here
// because a resolver that reaches for a timestamp the moment it sees one will
// get this table wrong.
//
// THE BLANK ROWS
//
// Three holds carry dept_code = '' or '   ' rather than NULL. They are the
// same defect — a hold nobody assigned — and `IS NULL` cannot see any of them.
// They are in the data and absent from the report by design, the same way
// SVC-03 is absent from the original detector's report. Do not "fix" this by
// widening the condition to TRIM(COALESCE(dept_code,'')) = ''.

import {
  DAY, HOUR, MIN, SEEDS, WINDOW_START,
  between, iso, lcg, overlapsOutage, pick,
} from './common.js';

const rand = lcg(SEEDS.holds);

const HOLD_TYPES = ['quality', 'engineering', 'material', 'customer'];
const DEPT_CODES = ['D-12', 'D-18', 'D-24', 'D-31', 'D-40', 'D-55', 'D-63'];

const MEMOS = [
  'Awaiting QC disposition',
  'Cross-batch contamination check',
  'Customer requested pause',
  'Engineering review of overlay data',
  'Material shortage upstream',
  'Pending FA result',
  'Procedure deviation logged',
  'Second-source validation pending',
  'Thickness out of spec, re-measure',
  'Waiting on supplier CoA',
];

// ---------------------------------------------------------------------------
// The 15 interesting holds, keyed by their position in the roster.
//
//   deptCode  null    the defect ASOP-341 exists to find
//   deptCode  '' etc  the same defect, invisible to IS NULL, by design
// ---------------------------------------------------------------------------

const SPECIAL_HOLDS = {
  4: { deptCode: null, handled: true },
  9: { deptCode: null, handled: true },
  13: { deptCode: null, handled: false, pinAt: '2026-07-29T02:55:00Z' },
  18: { deptCode: null, handled: true },
  22: { deptCode: '', handled: null, memo: 'Hold raised from the floor terminal' },
  27: { deptCode: null, handled: true },
  31: { deptCode: null, handled: true },
  35: { deptCode: null, handled: false },
  40: { deptCode: '   ', handled: null, memo: 'Bulk import from the 07-28 backfill' },
  46: { deptCode: null, handled: true },
  52: { deptCode: null, handled: true },
  58: { deptCode: null, handled: false, pinAt: '2026-07-29T05:30:00Z' },
  63: { deptCode: '', handled: null, memo: 'Bulk import from the 07-28 backfill' },
  71: { deptCode: null, handled: true },
  78: { deptCode: null, handled: true },
};

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

const rows = [];
const candidates = [];

for (let i = 0; i < 84; i += 1) {
  const holdId = `H-${3301 + i}`;
  const batchId = `B-${8801 + (i % 24)}`;
  const special = SPECIAL_HOLDS[i];

  const placedAt = special?.pinAt
    ? Date.parse(special.pinAt)
    : WINDOW_START +
      between(rand, 0, 12) * DAY +
      between(rand, 0, 23) * HOUR +
      between(rand, 0, 59) * MIN;

  // Most holds get released; some are still open when the window closes.
  const heldMinutes = between(rand, 45, 2600);
  const stillHeld = rand() < 0.22;
  const releasedAt = stillHeld ? null : placedAt + heldMinutes * MIN;

  const deptCode = special ? special.deptCode : pick(rand, DEPT_CODES);
  const memo = special?.memo ?? pick(rand, MEMOS);

  rows.push({
    hold_id: holdId,
    batch_id: batchId,
    placed_at: iso(placedAt),
    released_at: releasedAt === null ? null : iso(releasedAt),
    dept_code: deptCode,
    memo,
    hold_type: pick(rand, HOLD_TYPES),
  });

  // Only a genuine NULL is a candidate. The blank rows are the same defect and
  // are deliberately not listed here — nothing looks for them.
  if (!special || special.deptCode !== null) continue;

  candidates.push({
    table: 'hold_records',
    asopId: 'ASOP-341',
    handled: special.handled === true,
    payload: {
      hold_id: holdId,
      batch_id: batchId,
      dept_code: null, // JSON null, not a missing key — json_type() tells them apart
      memo,
    },
    // The sweep is the only clock involved, and it belongs to the automation,
    // not to the candidate.
    actionableAt: placedAt,
    intervalStart: placedAt,
    intervalEnd: releasedAt ?? placedAt,
    insideOutage: overlapsOutage(placedAt, placedAt + 30 * MIN),
  });
}

export const holdRecords = rows;
export const holdCandidates = candidates;
