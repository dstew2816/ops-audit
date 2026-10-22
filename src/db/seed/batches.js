// batch_queue_events — DETECTION SHAPE: countdown to a deadline.
//
// 24 batches, two steps each, two events per step: 96 rows.
//
// This is NOT elapsed duration. The qualifying quantity is the time REMAINING
// against queue_deadline at the batch's most recent event for that step:
//
//   (julianday(queue_deadline) - julianday(event_at)) * 1440
//
// which can be negative. queue_deadline belongs to the (batch_id, step_id)
// pair, so both of a step's rows carry the same value and it moves when the
// batch advances to the next step.
//
// 'at_risk' and 'expired' are terminal: the platform has already noticed those
// and flagged them, so they are not candidates however far past the deadline
// they sit. Only a batch still recorded as moving can be silently late.

import {
  ANALYSIS_END, DAY, HOUR, MIN, SEEDS, WINDOW_START,
  between, iso, lcg, overlapsOutage, pick,
} from './common.js';

const rand = lcg(SEEDS.batches);

/** Minutes of remaining time below which ASOP-207 wants the batch flagged. */
export const REMAINING_THRESHOLD_MINUTES = 60;

const TOOL_GROUPS = ['LINE-A', 'LINE-B', 'LINE-C', 'QC-D', 'PACK-E'];

// ---------------------------------------------------------------------------
// Roster. `remaining` is the minutes left against the deadline at the LAST
// event of the batch's second step — the number the detector has to compute.
// `finalType` is that event's type; the terminal ones are traps.
// ---------------------------------------------------------------------------

const BATCH_ROLES = [
  // --- still moving, inside the warning window: 16 candidates, 12 handled.
  { batch: 'B-8801', remaining: 44, finalType: 'in_transit', handled: true },
  { batch: 'B-8802', remaining: 12, finalType: 'in_transit', handled: true },
  { batch: 'B-8803', remaining: 51, finalType: 'queued', handled: true },
  { batch: 'B-8804', remaining: -35, finalType: 'in_transit', handled: false, pinAt: '2026-07-29T02:50:00Z' },
  { batch: 'B-8805', remaining: 28, finalType: 'in_transit', handled: true },
  { batch: 'B-8806', remaining: 7, finalType: 'queued', handled: true },
  { batch: 'B-8807', remaining: -18, finalType: 'in_transit', handled: false },
  { batch: 'B-8808', remaining: 33, finalType: 'in_transit', handled: true },
  { batch: 'B-8809', remaining: 55, finalType: 'queued', handled: true },
  { batch: 'B-8810', remaining: -72, finalType: 'queued', handled: false, pinAt: '2026-07-29T04:15:00Z' },
  { batch: 'B-8811', remaining: 19, finalType: 'in_transit', handled: true },
  { batch: 'B-8812', remaining: 47, finalType: 'in_transit', handled: true },
  { batch: 'B-8813', remaining: 3, finalType: 'queued', handled: true },
  { batch: 'B-8814', remaining: -9, finalType: 'in_transit', handled: false },
  { batch: 'B-8815', remaining: 38, finalType: 'in_transit', handled: true },
  { batch: 'B-8816', remaining: 22, finalType: 'queued', handled: true },

  // --- terminal. Deep past the deadline, and correctly NOT candidates: the
  // platform already flagged these, which is why the row type changed at all.
  { batch: 'B-8817', remaining: -240, finalType: 'expired', handled: null },
  { batch: 'B-8818', remaining: -415, finalType: 'expired', handled: null },
  { batch: 'B-8819', remaining: -96, finalType: 'expired', handled: null },
  { batch: 'B-8820', remaining: -14, finalType: 'at_risk', handled: null },
  { batch: 'B-8821', remaining: -50, finalType: 'at_risk', handled: null },

  // --- moving with plenty of time left.
  { batch: 'B-8822', remaining: 260, finalType: 'in_transit', handled: null },
  { batch: 'B-8823', remaining: 405, finalType: 'queued', handled: null },
  { batch: 'B-8824', remaining: 188, finalType: 'in_transit', handled: null },
];

const isCandidate = (role) =>
  (role.finalType === 'queued' || role.finalType === 'in_transit') &&
  role.remaining < REMAINING_THRESHOLD_MINUTES;

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

const rows = [];
const candidates = [];

BATCH_ROLES.forEach((role, index) => {
  const stepOne = `S-${String(10 + (index % 7)).padStart(2, '0')}`;
  const stepTwo = `S-${String(20 + (index % 9)).padStart(2, '0')}`;

  const legOneMinutes = between(rand, 20, 60);
  const gapMinutes = between(rand, 120, 600);
  const legTwoMinutes = between(rand, 10, 240);

  let firstQueued;
  if (role.pinAt) {
    // Work backwards so the LAST event lands where the case needs it.
    firstQueued = Date.parse(role.pinAt) - (gapMinutes + legTwoMinutes) * MIN;
  } else {
    firstQueued =
      WINDOW_START +
      6 * HOUR +
      between(rand, 0, 9) * DAY +
      between(rand, 0, 23) * HOUR +
      between(rand, 0, 59) * MIN;
  }

  let secondQueued = firstQueued + gapMinutes * MIN;
  let lastEvent = secondQueued + legTwoMinutes * MIN;

  // A handled batch cannot have crossed its threshold during the outage.
  if (role.handled === true && overlapsOutage(secondQueued, lastEvent)) {
    firstQueued += 20 * HOUR;
    secondQueued += 20 * HOUR;
    lastEvent += 20 * HOUR;
  }
  if (lastEvent > ANALYSIS_END - HOUR) {
    const shift = lastEvent - (ANALYSIS_END - HOUR);
    firstQueued -= shift;
    secondQueued -= shift;
    lastEvent -= shift;
  }

  // Step one always had room; step two carries the case.
  const deadlineOne = firstQueued + legOneMinutes * MIN + between(rand, 180, 420) * MIN;
  const deadlineTwo = lastEvent + role.remaining * MIN;

  rows.push(
    {
      batch_id: role.batch,
      step_id: stepOne,
      event_type: 'queued',
      event_at: iso(firstQueued),
      queue_deadline: iso(deadlineOne),
      next_tool_group: pick(rand, TOOL_GROUPS),
    },
    {
      batch_id: role.batch,
      step_id: stepOne,
      event_type: 'in_transit',
      event_at: iso(firstQueued + legOneMinutes * MIN),
      queue_deadline: iso(deadlineOne),
      next_tool_group: pick(rand, TOOL_GROUPS),
    },
    {
      batch_id: role.batch,
      step_id: stepTwo,
      event_type: 'queued',
      event_at: iso(secondQueued),
      queue_deadline: iso(deadlineTwo),
      next_tool_group: pick(rand, TOOL_GROUPS),
    },
    {
      batch_id: role.batch,
      step_id: stepTwo,
      event_type: role.finalType,
      event_at: iso(lastEvent),
      queue_deadline: iso(deadlineTwo),
      next_tool_group: null, // end of the recorded route
    },
  );

  if (!isCandidate(role)) return;

  candidates.push({
    table: 'batch_queue_events',
    asopId: 'ASOP-207',
    handled: role.handled === true,
    payload: {
      batch_id: role.batch,
      step_id: stepTwo,
      queue_deadline: iso(deadlineTwo),
    },
    // The countdown can only be observed at an event, so that is the earliest
    // the platform could have acted.
    actionableAt: lastEvent,
    intervalStart: secondQueued,
    intervalEnd: deadlineTwo,
    insideOutage: overlapsOutage(secondQueued, lastEvent),
  });
});

export const batchQueueEvents = rows.sort(
  (a, b) =>
    a.event_at.localeCompare(b.event_at) ||
    a.batch_id.localeCompare(b.batch_id) ||
    a.step_id.localeCompare(b.step_id),
);

export const batchCandidates = candidates;
