// The diagnosis this data was built to support, hand-written as literal data.
//
// The second piece of ground truth in this directory. baselines.js is seven
// hand-written detection queries and answers "which candidates were missed";
// this answers the next question — "why", and, before that, "which of these
// misses share a cause at all". Same relationship to src/engine/diagnose.js
// that baselines.js has to generate-sql.js: written by hand, never derived, and
// the thing a generated answer gets diffed against.
//
// IT IS DATA, NOT RULES.
//
// There is deliberately no rules engine here — no predicate that reads
// platform_status and emits an infrastructure finding, no comparison against
// thresholdHistory that emits a stale-config finding. Rules would be easy to
// write correctly because they would be written knowing what was planted, and
// a diagnosis layer that hand-written rules can reproduce has not demonstrated
// anything. The argument for a model doing this is that nobody can enumerate
// two hundred automations' failure modes in advance, and that argument only
// holds if these have not been enumerated as rules either.
//
// WHAT IS SCORED AND WHAT IS NOT
//
// Everything below is a complete diagnosis of all 24 misses, because that is
// what a real answer looks like and the scorer should be fed one. But only the
// parts that were deliberately planted are scored:
//
//   SCORED POSITIVELY   the outage cluster and its membership, the three
//                       coincidental findings and their classes
//   SCORED NEGATIVELY   the four in-window misses that the outage cannot
//                       explain, and the two designated singletons
//   NOT SCORED          the other seven, and every `cause` string here
//
// Scoring the seven would be inventing ground truth. Nothing was planted about
// them, they carry no shared cause, and a diagnosis that groups or ignores them
// is not demonstrably wrong. They are written out anyway so that this file is a
// whole answer rather than a scoring key with gaps in it.
//
// The prose in `cause` is never compared. It is here to say what each finding
// means, for a reader of this file; a model that reaches the same conclusion in
// different words is right.

// The class vocabulary lives in cause-classes.js, not here, so that
// src/engine/diagnose.js can import the enum without importing the answers.
export { CAUSE_CLASSES } from './cause-classes.js';

// ---------------------------------------------------------------------------
// Miss identifiers
// ---------------------------------------------------------------------------
//
// One per miss, in the form src/engine/diagnose.js builds from each baseline's
// antiJoinKeys: the ASOP id, then that candidate type's identity columns, joined
// by ':'. ASOP-402 identifies a check by check_id alone and ASOP-207 needs three
// columns to name a batch's position, so these are not all the same length.
// That asymmetry is the candidate types', not this file's.
//
// The ids are written out literally rather than computed, so that a change to
// the seed data that moves a miss shows up here as an id that no longer
// resolves. scripts/diagnose-check.mjs fails on exactly that.

// The outage: 2026-07-29 02:00–08:00 (PW-004), six hours, no replay on recovery.
const OUTAGE_MISSES = [
  'ASOP-114:P-104:2026-07-29T02:35:00Z',
  'ASOP-114:P-110:2026-07-29T03:20:00Z',
  'ASOP-207:B-8804:S-23:2026-07-29T02:15:00Z',
  'ASOP-207:B-8810:S-20:2026-07-29T03:03:00Z',
  'ASOP-233:T-04:2026-07-29T02:25:00Z',
  'ASOP-233:T-20:2026-07-29T03:40:00Z',
  'ASOP-402:C-018',
  'ASOP-402:C-050',
];

/**
 * Inside the outage window, and not explained by it.
 *
 * These four are the discrimination case this whole layer is built around. Each
 * one's timestamp sits inside PW-004, so anything clustering on time alone
 * sweeps them in and reports twelve misses with one cause. They belong to the
 * two ASOPs whose detections have no time predicate at all — ASOP-341 evaluates
 * every hold_records row for a null dept_code and ASOP-455 qualifies on an
 * attempt counter — and a condition with no time dimension is exactly as
 * detectable after recovery as during the outage. Neither ASOP's baseline takes
 * $end and neither joins platform_status.
 *
 * So the platform's being down does not account for these, and the evidence
 * that says so is structural, not temporal. Scored negatively only: they must
 * not appear in any finding classed `infrastructure`.
 */
const IN_WINDOW_NOT_OUTAGE = [
  'ASOP-341:H-3314',
  'ASOP-341:H-3359',
  'ASOP-455:M-0043',
  'ASOP-455:M-0013',
];

/**
 * Pinned clear of both clusters, on purpose, and left alone.
 *
 * T-09 is bypassed and the bypass is its own explanation, so beside cluster B
 * it would have read as a fourth coincidental finding. C-068 has no explanation
 * at all in the data. Both were moved by the seeders specifically so that they
 * would stand alone — see the comments in src/db/seed/tools.js and
 * src/db/seed/checks.js.
 *
 * Scored negatively only: neither may be absorbed into a finding with any other
 * miss in it. Nothing is required about what a diagnosis says about them on
 * their own, including the class, because there is nothing to be right about.
 */
const DESIGNATED_SINGLETONS = ['ASOP-233:T-09:2026-08-04T14:05:00Z', 'ASOP-402:C-068'];

// ---------------------------------------------------------------------------
// The findings
// ---------------------------------------------------------------------------

export const EXPECTED_FINDINGS = [
  // -- The common cause -----------------------------------------------------
  {
    key: 'outage',
    title: 'Orchestrator outage on 2026-07-29 swallowed eight candidates',
    causeClass: 'infrastructure',
    missIds: OUTAGE_MISSES,
    cause:
      'The platform was down from 02:00 to 08:00 and performs no replay on recovery. Eight conditions opened inside that window across four ASOPs and nothing selected them. One system-side fix; nothing is wrong with any of the four automations.',
  },

  // -- Three coincidental findings, 73 minutes apart on 2026-07-23 ----------
  //
  // Tighter in time than the outage cluster, which spreads over 4h15m, and the
  // platform was up throughout (PW-001, "Nominal."). Proximity is the whole
  // reason these three are here: a layer that groups on time gets the loose
  // cluster right and the tight one wrong, which is the opposite of what
  // clustering on time would predict.
  {
    key: 'skip-breadth',
    title: 'Staffing gap recorded as a skip reason on ASOP-402',
    causeClass: 'configuration',
    missIds: ['ASOP-402:C-034'],
    cause:
      'The check was bypassed with skip_reason "Operator unavailable on shift". No operator being on shift is a staffing failure, not a reason the check was not due — the bypass is scoped too broadly and is absorbing a real gap. The check still never ran.',
  },
  {
    key: 'retry-boundary',
    title: 'Notification one attempt over the ceiling never escalated',
    causeClass: 'logic-gap',
    missIds: ['ASOP-455:M-0062'],
    cause:
      'attempts = 4 against a ceiling of 3, unacknowledged, and no hard bounce to excuse it. It qualifies by a single attempt and the platform did not select it, so the criterion it actually applies is narrower than the one the ASOP states.',
  },
  {
    key: 'threshold-stale',
    title: 'Tool downtime inside the superseded threshold band',
    causeClass: 'configuration',
    missIds: ['ASOP-233:T-23:2026-07-23T09:20:00Z'],
    cause:
      'T-23 was down and unscheduled for 38 minutes — over the current threshold of 30, under the 60 it was revised down from on 2026-05-14. The revision was never applied to the platform, so a downtime in the band between the two values is invisible to it and visible here. A threshold history alone is not evidence of this: ASOP-114 and ASOP-402 both carry one and both were applied.',
  },

  // -- Inside the outage window, structurally unexplained by it -------------
  {
    key: 'hold-h3314',
    title: 'Engineering hold with no department, unassigned',
    causeClass: 'configuration',
    missIds: ['ASOP-341:H-3314'],
    cause:
      'dept_code is null and hold_type is engineering, which stands the backfill down. Placed at 02:55 on 2026-07-29, inside the outage window, and that is a coincidence: ASOP-341 evaluates every row in the table with no time predicate, so the hold was just as detectable after recovery as during.',
  },
  {
    key: 'hold-h3359',
    title: 'Material hold with no department, never backfilled',
    causeClass: 'unexplained',
    missIds: ['ASOP-341:H-3359'],
    cause:
      'dept_code is null, no bypass applies, and the platform never selected it. Placed inside the outage window, but ASOP-341 has no time dimension and the hold stayed unreleased until 2026-07-30 — long after recovery. Nothing in the evidence accounts for the silence.',
  },
  {
    key: 'mail-m0043',
    title: 'Hard-bounced notification past the retry ceiling',
    causeClass: 'configuration',
    missIds: ['ASOP-455:M-0043'],
    cause:
      'Eleven attempts, unacknowledged, bounce_code 550. The hard bounce suppressed escalation. Queued inside the outage window, which is incidental — ASOP-455 qualifies on the attempt counter and has no time predicate.',
  },
  {
    key: 'mail-m0013',
    title: 'Hard-bounced notification past the retry ceiling',
    causeClass: 'configuration',
    missIds: ['ASOP-455:M-0013'],
    cause:
      'Nine attempts, unacknowledged, bounce_code 550, same suppression as M-0043 and the same reason the outage does not explain it.',
  },

  // -- The two pinned singletons -------------------------------------------
  {
    key: 'tool-t09',
    title: 'Facility-wide event on T-09 routed to another escalation path',
    causeClass: 'configuration',
    missIds: ['ASOP-233:T-09:2026-08-04T14:05:00Z'],
    cause:
      'Down and unscheduled for 130 minutes with reason_code RC-FACILITY, which this ASOP defers to a separate path. Its own bypass is the whole explanation and it shares a cause with nothing else.',
  },
  {
    key: 'check-c068',
    title: 'Overdue check on T-20 with no explanation in the data',
    causeClass: 'unexplained',
    missIds: ['ASOP-402:C-068'],
    cause:
      'Due 2026-08-05 10:00, 14 hours overdue, in scope, no skip reason, platform up. Nothing in the evidence says why it was not selected. The honest answer is that there is not one, and attaching it to any other finding would be manufacturing a cause to avoid saying so.',
  },

  // -- The remaining seven. Written out; not scored. ------------------------
  {
    key: 'port-p106',
    title: 'Blocked port under maintenance',
    causeClass: 'configuration',
    missIds: ['ASOP-114:P-106:2026-07-30T16:10:00Z'],
    cause: 'Blocked 145 minutes with port_mode = maint, which stands the recovery down.',
  },
  {
    key: 'port-p114',
    title: 'Port error under maintenance',
    causeClass: 'configuration',
    missIds: ['ASOP-118:P-114:2026-07-29T17:24:00Z'],
    cause:
      'In error 58 minutes with port_mode = maint. After the outage closed, and unrelated to it.',
  },
  {
    key: 'batch-b8807',
    title: 'Batch past its queue deadline, no warning',
    causeClass: 'unexplained',
    missIds: ['ASOP-207:B-8807:S-26:2026-07-28T18:00:00Z'],
    cause: '18 minutes past the deadline, still in transit, platform up. No cause in the evidence.',
  },
  {
    key: 'batch-b8814',
    title: 'Batch nine minutes past its queue deadline',
    causeClass: 'unexplained',
    missIds: ['ASOP-207:B-8814:S-24:2026-07-30T02:15:00Z'],
    cause: 'Nine minutes over, still in transit, platform up. No cause in the evidence.',
  },
  {
    key: 'hold-h3336',
    title: 'Engineering hold with no department, still open',
    causeClass: 'configuration',
    missIds: ['ASOP-341:H-3336'],
    cause: 'dept_code null, hold_type engineering, never released. Same bypass as H-3314.',
  },
  {
    key: 'check-c094',
    title: 'Weekly check superseded by a manual one',
    causeClass: 'configuration',
    missIds: ['ASOP-402:C-094'],
    cause:
      'skip_reason "Superseded by manual check". Unlike C-034 this is a reason the check was not due, so the bypass is doing what it should.',
  },
  {
    key: 'mail-m0027',
    title: 'Hard-bounced notification to area-leads',
    causeClass: 'configuration',
    missIds: ['ASOP-455:M-0027'],
    cause: 'Five attempts, unacknowledged, bounce_code 550. Well clear of both clusters.',
  },
];

// ---------------------------------------------------------------------------
// The scoring key
// ---------------------------------------------------------------------------

/**
 * What a diagnosis is judged on. Read by src/engine/diagnose-score.js and by
 * nothing else; src/engine/diagnose.js must never import this file.
 */
export const SCORING_KEY = {
  /** Exactly these eight, in one finding, classed infrastructure. */
  outage: {
    missIds: OUTAGE_MISSES,
    causeClass: 'infrastructure',
    windowId: 'PW-004',
  },

  /**
   * Three separate findings, one miss each, each with its own class. Merging
   * any two of them is a failure even if the merged finding's class is right
   * for both — two of the three are `configuration` for unrelated reasons, so a
   * layer that groups by class rather than by cause fails here too.
   */
  coincidental: [
    { missId: 'ASOP-402:C-034', causeClass: 'configuration', label: 'bypass scoped too broadly' },
    { missId: 'ASOP-455:M-0062', causeClass: 'logic-gap', label: 'criterion narrower than stated' },
    {
      missId: 'ASOP-233:T-23:2026-07-23T09:20:00Z',
      causeClass: 'configuration',
      label: 'threshold revision never applied',
    },
  ],

  /** Must not appear in any finding classed `infrastructure`. */
  notExplainedByOutage: IN_WINDOW_NOT_OUTAGE,

  /** Must not appear in any finding that also contains another miss. */
  standAlone: DESIGNATED_SINGLETONS,
};

/** Total misses this file accounts for. The harness checks it against the data. */
export const EXPECTED_MISS_COUNT = EXPECTED_FINDINGS.reduce(
  (total, finding) => total + finding.missIds.length,
  0,
);
