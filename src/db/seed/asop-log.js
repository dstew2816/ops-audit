// asop_activity_log — what the automation platform actually did.
//
// Built from the `handled` candidates the six table seeders produced, the same
// way executionLog.js is built from the episodes in events.js: from the
// intended outcome, never re-derived through a detector, so the log stays an
// independent record rather than a restatement of the analysis.
//
// THE PREMISE
//
// A row exists here only for a candidate that was successfully picked up. A
// missed candidate produces NO ROW AT ALL — not a row with a failure flag, not
// a row with a null outcome, nothing. The platform cannot log a candidate it
// never selected, and reconstructing that absence is the entire job.
//
// SELECTION PAYLOADS
//
// This is a real system log and has no candidate_type column. selection_payload
// holds the literal columns and values grabbed during selection, so its shape
// differs per candidate type. Two of the keys are ambiguous across shapes:
//
//   $.tool_id   port, tool AND check payloads
//   $.batch_id  batch AND hold payloads
//
// so an anti-join keyed on the JSON path alone over-matches. It has to be
// scoped by asop_id as well.
//
// OUTCOME
//
// Recorded and deliberately unused. This pass measures candidate SELECTION,
// not execution: an automation that selected correctly and then failed is not
// a miss. Keep the column, ignore it in the logic.

import { MIN, SEEDS, between, iso, lcg, pick } from './common.js';
import { portCandidates } from './ports.js';
import { batchCandidates } from './batches.js';
import { toolCandidates } from './tools.js';
import { holdCandidates } from './holds.js';
import { checkCandidates } from './checks.js';
import { emailCandidates } from './email.js';

const rand = lcg(SEEDS.asop);

export const ASOPS = {
  'ASOP-114': {
    name: 'Port Blocked Recovery',
    sponsor: 'm.okonkwo',
    department: 'Ops Automation',
    table: 'port_state_history',
    payloadKey: 'port_id',
  },
  'ASOP-118': {
    name: 'Port Error Escalation',
    sponsor: 'm.okonkwo',
    department: 'Ops Automation',
    table: 'port_state_history',
    payloadKey: 'port_id',
  },
  'ASOP-207': {
    name: 'Queue Deadline Warning',
    sponsor: 'r.lindqvist',
    department: 'Logistics',
    table: 'batch_queue_events',
    payloadKey: 'batch_id',
  },
  'ASOP-233': {
    name: 'Unplanned Tool Down Notify',
    sponsor: 'p.varghese',
    department: 'Maintenance',
    table: 'tool_status_log',
    payloadKey: 'tool_id',
  },
  'ASOP-341': {
    name: 'Hold Department Backfill',
    sponsor: 'a.ferreira',
    department: 'Quality',
    table: 'hold_records',
    payloadKey: 'hold_id',
  },
  'ASOP-402': {
    name: 'Missed Check Sweep',
    sponsor: 'p.varghese',
    department: 'Quality Control',
    table: 'scheduled_checks',
    payloadKey: 'check_id',
  },
  'ASOP-455': {
    name: 'Notification Retry Escalation',
    sponsor: 'r.lindqvist',
    department: 'Ops Automation',
    table: 'email_queue',
    payloadKey: 'message_id',
  },
};

export const allCandidates = [
  ...portCandidates,
  ...batchCandidates,
  ...toolCandidates,
  ...holdCandidates,
  ...checkCandidates,
  ...emailCandidates,
];

// Recorded, and not used by detection.
const outcomeFor = () => {
  const roll = rand();
  if (roll < 0.87) return 'success';
  if (roll < 0.96) return 'partial';
  return 'failed';
};

const entries = [];

for (const candidate of allCandidates) {
  if (!candidate.handled) continue; // no row: this is the point

  const asop = ASOPS[candidate.asopId];
  // Polling picks the condition up a few minutes after it becomes actionable.
  const firedAt = candidate.actionableAt + between(rand, 0, 9) * MIN + between(rand, 0, 59) * 1000;

  entries.push({
    asop_id: candidate.asopId,
    asop_name: asop.name,
    sponsor: asop.sponsor,
    department: asop.department,
    fired_at: firedAt,
    outcome: outcomeFor(),
    selection_payload: JSON.stringify(candidate.payload),
  });
}

// ---------------------------------------------------------------------------
// Noise: firings against things that are not candidates in this window —
// conditions carried over from before it opened, or manual invocations.
//
// None of these correspond to a missed candidate. They are here so the
// anti-join has to match on the payload contents and not merely on the
// presence of a row for the right ASOP.
// ---------------------------------------------------------------------------

const NOISE = [
  { asop: 'ASOP-114', at: '2026-07-23T04:12:00Z', payload: { port_id: 'P-122', tool_id: 'T-22', state: 'blocked', entered_at: '2026-07-22T23:40:00Z' } },
  { asop: 'ASOP-114', at: '2026-07-27T19:33:00Z', payload: { port_id: 'P-127', tool_id: 'T-03', state: 'blocked', entered_at: '2026-07-27T18:55:00Z' } },
  { asop: 'ASOP-118', at: '2026-08-01T11:07:00Z', payload: { port_id: 'P-125', tool_id: 'T-01', state: 'error', entered_at: '2026-08-01T10:44:00Z' } },
  { asop: 'ASOP-207', at: '2026-07-25T02:48:00Z', payload: { batch_id: 'B-8823', step_id: 'S-27', queue_deadline: '2026-07-25T04:00:00Z' } },
  { asop: 'ASOP-233', at: '2026-07-24T08:15:00Z', payload: { tool_id: 'T-06', status: 'down', status_start: '2026-07-22T21:10:00Z', reason_code: 'RC-ALARM' } },
  { asop: 'ASOP-341', at: '2026-07-26T13:20:00Z', payload: { hold_id: 'H-3290', batch_id: 'B-8812', dept_code: null, memo: 'Carried over from the previous window' } },
  { asop: 'ASOP-341', at: '2026-08-04T09:41:00Z', payload: { hold_id: 'H-3288', batch_id: 'B-8805', dept_code: null, memo: 'Carried over from the previous window' } },
  { asop: 'ASOP-402', at: '2026-07-30T16:58:00Z', payload: { check_id: 'C-402', tool_id: 'T-11', due_at: '2026-07-30T16:00:00Z' } },
  { asop: 'ASOP-455', at: '2026-08-02T22:14:00Z', payload: { message_id: 'M-0912', recipient_group: 'ops-automation', attempts: 5 } },
];

for (const noise of NOISE) {
  const asop = ASOPS[noise.asop];
  entries.push({
    asop_id: noise.asop,
    asop_name: asop.name,
    sponsor: asop.sponsor,
    department: asop.department,
    fired_at: Date.parse(noise.at),
    outcome: pick(rand, ['success', 'success', 'partial']),
    selection_payload: JSON.stringify(noise.payload),
  });
}

export const asopActivityLog = entries
  .sort((a, b) => a.fired_at - b.fired_at)
  .map((entry, i) => ({
    log_id: `LOG-${String(i + 1).padStart(4, '0')}`,
    asop_id: entry.asop_id,
    asop_name: entry.asop_name,
    sponsor: entry.sponsor,
    department: entry.department,
    fired_at: iso(entry.fired_at),
    outcome: entry.outcome,
    selection_payload: entry.selection_payload,
  }));
