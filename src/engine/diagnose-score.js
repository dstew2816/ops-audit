// Scoring a diagnosis against the hand-written findings.
//
// Pure, on the same terms as score.js: no model, no network, no environment, no
// database. It takes a list of findings and a scoring key and reports what
// agrees and what does not. That is what lets scripts/diagnose-check.mjs prove
// this module with --self-test before spending a live call — feed it the
// expected findings and every dimension has to come out perfect, then feed it
// deliberately wrong ones and the RIGHT dimensions have to fail.
//
// The second half of that matters more here than it did for SQL. A generated
// query that finds the wrong rows is caught by counting them; a diagnosis is
// prose and grouping, and a scorer that quietly accepts anything looks exactly
// like a diagnosis layer that works. The mutations at the bottom of this file
// exist so that "the scorer passed" is a statement about the diagnosis.
//
// FIVE DIMENSIONS, BECAUSE THEY FAIL SEPARATELY
//
//   coverage      Is this a partition of the misses at all?
//   outage        Is the one genuine common cause recovered, and only it?
//   trap          Is anything blamed on the outage that the outage cannot explain?
//   coincidental  Are the three unrelated causes three findings, correctly classed?
//   standAlone    Are the pinned singletons left alone?
//
// `outage` and `trap` are separate on purpose and it is the least obvious split
// in here. A layer that sweeps all twelve in-window misses into one finding
// fails both. But a layer that reports the correct eight AND a second
// infrastructure finding holding the other four has a perfect `outage` score
// and still believes the outage caused them — same wrong conclusion, arrived at
// tidily. Only `trap` sees it.
//
// WHAT IS NOT SCORED
//
// Every `cause`, `title` and `evidence` string. They are the readable part of
// the answer and they are not comparable — a diagnosis that reaches the right
// conclusion in different words is right, and scoring the wording would reward
// paraphrasing the ground truth. What is scored is which misses were grouped
// together and what class the group was given, both of which are decisions
// rather than phrasings.
//
// Seventeen of the twenty-four misses have no positive expectation attached,
// and that is deliberate rather than an omission — see the note on what is
// scored in src/db/expected-findings.js.

import { CAUSE_CLASSES } from '../db/cause-classes.js';
import { EXPECTED_FINDINGS, SCORING_KEY } from '../db/expected-findings.js';

/**
 * The expected findings in the shape a model returns.
 *
 * Every field comes from the ground truth itself, so scoring this has to come
 * out perfect on all five dimensions. It is the only thing in this module that
 * knows how src/db/expected-findings.js maps onto a diagnosis.
 */
export function diagnosisFromExpected(findings = EXPECTED_FINDINGS) {
  return findings.map((finding) => ({
    title: finding.title,
    causeClass: finding.causeClass,
    missIds: [...finding.missIds],
    cause: finding.cause,
    evidence: [finding.cause],
    confidence: 'high',
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** missId -> the index of the finding holding it. */
function locate(findings) {
  const index = new Map();
  findings.forEach((finding, position) => {
    for (const id of finding.missIds ?? []) {
      if (!index.has(id)) index.set(id, position);
    }
  });
  return index;
}

const setDiff = (a, b) => a.filter((entry) => !b.includes(entry));

// ---------------------------------------------------------------------------
// The dimensions
// ---------------------------------------------------------------------------

/**
 * Is this a partition of the misses?
 *
 * parseDiagnosis() already rejects an unknown id, a repeated one and a dropped
 * one before a diagnosis gets this far. Checked again here, independently, for
 * the same reason the house rules are applied both before a generated query
 * runs and after it: a caller that skipped validation, or a validator that
 * changed, should not be able to make this dimension pass by default.
 *
 * `knownMissIds` is optional. Without it the within-answer rules are still
 * checked; only completeness needs to know what the full set was.
 */
function scoreCoverage(findings, knownMissIds) {
  const seen = new Map();
  const duplicates = [];
  const unknown = [];
  const known = knownMissIds ? new Set(knownMissIds) : null;

  findings.forEach((finding, position) => {
    for (const id of finding.missIds ?? []) {
      if (known && !known.has(id)) unknown.push(id);
      if (seen.has(id)) duplicates.push(id);
      else seen.set(id, position);
    }
  });

  const uncovered = knownMissIds ? knownMissIds.filter((id) => !seen.has(id)) : [];

  return {
    findings: findings.length,
    covered: seen.size,
    expected: knownMissIds ? knownMissIds.length : null,
    duplicates,
    unknown,
    uncovered,
    comparable: Boolean(knownMissIds),
    ok: duplicates.length === 0 && unknown.length === 0 && uncovered.length === 0,
  };
}

/**
 * The one genuine common cause: eight misses across four ASOPs, one finding.
 *
 * Splitting them is a failure as well as merging into them. Eight misses with
 * one cause are one fix, and reporting them as four findings — one per ASOP,
 * which is the shape the data arrives in — hides that.
 */
function scoreOutage(findings, key, where) {
  const expected = key.missIds;
  const positions = [...new Set(expected.map((id) => where.get(id)).filter((p) => p !== undefined))];
  const unlocated = expected.filter((id) => !where.has(id));

  if (positions.length !== 1) {
    return {
      expected: expected.length,
      findingsSpanned: positions.length,
      finding: null,
      causeClass: null,
      extras: [],
      omissions: unlocated,
      unlocated,
      ok: false,
    };
  }

  const finding = findings[positions[0]];
  const extras = setDiff(finding.missIds, expected);

  return {
    expected: expected.length,
    findingsSpanned: 1,
    finding: { index: positions[0], title: finding.title, size: finding.missIds.length },
    causeClass: finding.causeClass ?? null,
    extras,
    omissions: [],
    unlocated,
    ok: extras.length === 0 && unlocated.length === 0 && finding.causeClass === key.causeClass,
  };
}

/**
 * Misses inside the outage window that the outage does not account for.
 *
 * Scored negatively and only negatively. Nothing is required about how these
 * are grouped or classed; the single thing they must not be is attributed to
 * the platform being down. Their detections have no time dimension, so the
 * window they fall in is a coincidence of when the row was written.
 */
function scoreTrap(findings, key, where) {
  const violations = [];
  for (const id of key.notExplainedByOutage) {
    const position = where.get(id);
    if (position === undefined) continue;
    const finding = findings[position];
    if (finding.causeClass === 'infrastructure') {
      violations.push({ missId: id, findingIndex: position, title: finding.title });
    }
  }
  return { checked: key.notExplainedByOutage.length, violations, ok: violations.length === 0 };
}

/**
 * Three misses within 73 minutes of each other, three unrelated causes.
 *
 * Each has to be its own finding, holding nothing else, with its own class. Two
 * of the three are `configuration` for entirely different reasons, so grouping
 * by class rather than by cause fails here as well as grouping by time.
 */
function scoreCoincidental(findings, key, where) {
  // expectedClass and actualClass are named apart rather than both being
  // `causeClass`, because spreading the key entry over the finding's own class
  // would silently overwrite the thing being compared with the thing it is
  // being compared to, and the check would pass unconditionally.
  const entries = key.coincidental.map((entry) => {
    const base = { missId: entry.missId, label: entry.label, expectedClass: entry.causeClass };
    const position = where.get(entry.missId);
    if (position === undefined) {
      return { ...base, findingIndex: null, size: 0, sharesWith: [], actualClass: null, ok: false };
    }
    const finding = findings[position];
    const sharesWith = setDiff(finding.missIds, [entry.missId]);
    return {
      ...base,
      findingIndex: position,
      size: finding.missIds.length,
      sharesWith,
      actualClass: finding.causeClass ?? null,
      ok: sharesWith.length === 0 && finding.causeClass === entry.causeClass,
    };
  });

  const positions = entries.map((entry) => entry.findingIndex).filter((p) => p !== null);
  const distinct = new Set(positions).size === key.coincidental.length;

  return {
    entries,
    distinctFindings: new Set(positions).size,
    expectedFindings: key.coincidental.length,
    distinct,
    ok: distinct && entries.every((entry) => entry.ok),
  };
}

/**
 * The two misses pinned clear of every cluster.
 *
 * Negative only, again: they must not be absorbed into a finding with anything
 * else in it. What a diagnosis says about either one on its own — including the
 * class — is not scored, because nothing was planted for it to be right about.
 */
function scoreStandAlone(findings, key, where) {
  const violations = [];
  for (const id of key.standAlone) {
    const position = where.get(id);
    if (position === undefined) continue;
    const finding = findings[position];
    if (finding.missIds.length > 1) {
      violations.push({
        missId: id,
        findingIndex: position,
        title: finding.title,
        absorbedWith: setDiff(finding.missIds, [id]),
      });
    }
  }
  return { checked: key.standAlone.length, violations, ok: violations.length === 0 };
}

// ---------------------------------------------------------------------------

/**
 * Score one diagnosis.
 *
 * @param {object[]} findings      {title, causeClass, missIds, ...} per finding
 * @param {object}   [key]         defaults to the key in expected-findings.js
 * @param {string[]} [knownMissIds] every miss in the bundle, for completeness
 */
export function scoreDiagnosis({ findings, key = SCORING_KEY, knownMissIds = null }) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return {
      ok: false,
      dimensions: {},
      failures: ['no findings to score'],
    };
  }

  const badClass = findings.filter((finding) => !CAUSE_CLASSES.includes(finding.causeClass));
  const where = locate(findings);

  const coverage = scoreCoverage(findings, knownMissIds);
  const outage = scoreOutage(findings, key.outage, where);
  const trap = scoreTrap(findings, key, where);
  const coincidental = scoreCoincidental(findings, key, where);
  const standAlone = scoreStandAlone(findings, key, where);

  const failures = [];

  for (const finding of badClass) {
    failures.push(`unknown causeClass ${JSON.stringify(finding.causeClass)} on "${finding.title}"`);
  }

  if (coverage.duplicates.length > 0) {
    failures.push(`${coverage.duplicates.length} miss(es) in more than one finding`);
  }
  if (coverage.unknown.length > 0) {
    failures.push(`${coverage.unknown.length} missId(s) not in the bundle`);
  }
  if (coverage.uncovered.length > 0) {
    failures.push(
      `${coverage.uncovered.length} miss(es) in no finding: ${coverage.uncovered.join(', ')}`,
    );
  }

  if (outage.findingsSpanned !== 1) {
    failures.push(
      `the outage cluster is split across ${outage.findingsSpanned} finding(s); it is one cause and one fix`,
    );
  } else {
    if (outage.extras.length > 0) {
      failures.push(
        `outage finding holds ${outage.finding.size} misses, not ${outage.expected} — ` +
          `the outage does not account for ${outage.extras.join(', ')}`,
      );
    }
    if (outage.causeClass !== key.outage.causeClass) {
      failures.push(
        `outage finding classed ${outage.causeClass}, expected ${key.outage.causeClass}`,
      );
    }
  }

  for (const violation of trap.violations) {
    failures.push(
      `${violation.missId} is attributed to infrastructure ("${violation.title}") — ` +
        `its detection has no time dimension, so the outage cannot explain it`,
    );
  }

  if (!coincidental.distinct) {
    failures.push(
      `the three coincidental misses fall in ${coincidental.distinctFindings} finding(s), ` +
        `not ${coincidental.expectedFindings} — they are unrelated causes that happened close together`,
    );
  }
  for (const entry of coincidental.entries) {
    if (entry.findingIndex === null) {
      failures.push(`${entry.missId} (${entry.label}) appears in no finding`);
      continue;
    }
    if (entry.sharesWith.length > 0) {
      failures.push(
        `${entry.missId} (${entry.label}) is grouped with ${entry.sharesWith.join(', ')}`,
      );
    }
    if (entry.actualClass !== entry.expectedClass) {
      failures.push(
        `${entry.missId} classed ${entry.actualClass}, expected ${entry.expectedClass} (${entry.label})`,
      );
    }
  }

  for (const violation of standAlone.violations) {
    failures.push(
      `${violation.missId} is absorbed into "${violation.title}" with ` +
        `${violation.absorbedWith.join(', ')} — it was pinned clear of every cluster`,
    );
  }

  return {
    ok:
      badClass.length === 0 &&
      coverage.ok &&
      outage.ok &&
      trap.ok &&
      coincidental.ok &&
      standAlone.ok,
    dimensions: { coverage, outage, trap, coincidental, standAlone },
    failures,
  };
}

// ---------------------------------------------------------------------------
// Mutations: proving the scorer can fail
// ---------------------------------------------------------------------------
//
// Each one takes the expected diagnosis and breaks it in one specific way, and
// declares which dimensions must go red. The self-test asserts the exact set,
// not merely that something failed — a scorer that fails everything whenever
// anything is wrong is no more useful than one that passes everything, because
// neither tells you what went wrong.
//
// `over-merged` is the one that matters. It is the answer this whole dataset
// was built to reject: group the misses by when they happened, report the
// twelve inside the outage window as one infrastructure finding, and report the
// three within 73 minutes on 2026-07-23 as another. It is what a GROUP BY would
// produce, it looks like a clean result, and it is wrong twice over.

/**
 * The first missId of the expected finding filed under this key.
 *
 * Mutations address findings through their CONTENT rather than their position,
 * because merging rewrites the array and any index taken from EXPECTED_FINDINGS
 * beforehand stops pointing at the same thing the moment one merge has run.
 */
function anchorOf(key) {
  const finding = EXPECTED_FINDINGS.find((entry) => entry.key === key);
  if (!finding) throw new Error(`No expected finding keyed ${key}`);
  return finding.missIds[0];
}

/** Whichever finding currently holds this miss. */
function holderOf(diagnosis, missId) {
  const index = diagnosis.findIndex((finding) => finding.missIds.includes(missId));
  if (index < 0) throw new Error(`No finding holds ${missId}`);
  return index;
}

/** Merge the findings holding these keys' misses into the first, as one finding. */
function merge(diagnosis, keys, { title, causeClass = null } = {}) {
  const indices = [...new Set(keys.map((key) => holderOf(diagnosis, anchorOf(key))))];
  const head = diagnosis[indices[0]];

  const merged = {
    ...head,
    title: title ?? head.title,
    causeClass: causeClass ?? head.causeClass,
    missIds: indices.flatMap((index) => diagnosis[index].missIds),
  };

  return diagnosis
    .map((finding, index) => (index === indices[0] ? merged : finding))
    .filter((_, index) => index === indices[0] || !indices.includes(index));
}

export const MUTATIONS = [
  {
    name: 'over-merged',
    what: 'everything inside the outage window as one finding, cluster B as another',
    why: 'the answer a GROUP BY on time produces, and the reason this dataset exists',
    mustFail: ['outage', 'trap', 'coincidental'],
    build: (diagnosis) => {
      const merged = merge(
        diagnosis,
        ['outage', 'hold-h3314', 'hold-h3359', 'mail-m0043', 'mail-m0013'],
        { title: 'Everything missed during the 2026-07-29 outage', causeClass: 'infrastructure' },
      );
      return merge(merged, ['skip-breadth', 'retry-boundary', 'threshold-stale'], {
        title: 'Cluster of misses on the morning of 2026-07-23',
        causeClass: 'configuration',
      });
    },
  },
  {
    name: 'outage-split',
    what: 'the eight outage misses reported one finding per ASOP',
    why: 'one cause and one fix, reported as four problems',
    mustFail: ['outage'],
    build: (diagnosis) =>
      diagnosis.flatMap((finding) => {
        if (!finding.missIds.includes(anchorOf('outage'))) return [finding];
        const byAsop = new Map();
        for (const id of finding.missIds) {
          const asopId = id.split(':')[0];
          byAsop.set(asopId, [...(byAsop.get(asopId) ?? []), id]);
        }
        return [...byAsop.entries()].map(([asopId, missIds]) => ({
          ...finding,
          title: `${asopId} missed candidates during the outage`,
          missIds,
        }));
      }),
  },
  {
    name: 'outage-misclassed',
    what: 'the right eight misses, called a configuration problem',
    why: 'membership and class are checked in the same dimension; this proves the class half is live',
    mustFail: ['outage'],
    build: (diagnosis) =>
      diagnosis.map((finding) =>
        finding.missIds.includes(anchorOf('outage'))
          ? { ...finding, causeClass: 'configuration' }
          : finding,
      ),
  },
  {
    name: 'trap-as-second-outage',
    what: 'the correct eight, plus a second infrastructure finding holding the other four',
    why: 'perfect on membership, same wrong conclusion — the case that needs its own dimension',
    mustFail: ['trap'],
    build: (diagnosis) =>
      merge(diagnosis, ['hold-h3314', 'hold-h3359', 'mail-m0043', 'mail-m0013'], {
        title: 'Further candidates missed during the outage window',
        causeClass: 'infrastructure',
      }),
  },
  {
    name: 'singleton-absorbed',
    what: 'the two pinned singletons grouped together',
    why: 'the pressure to account for every miss, applied to two that have nothing in common',
    mustFail: ['standAlone'],
    build: (diagnosis) =>
      merge(diagnosis, ['tool-t09', 'check-c068'], {
        title: 'Unattributed misses in the first week of August',
        causeClass: 'configuration',
      }),
  },
  {
    name: 'coincidental-misclassed',
    what: 'the stale threshold called a data problem',
    why: 'right grouping, wrong class — proves the class check is live inside the grouping check',
    mustFail: ['coincidental'],
    build: (diagnosis) =>
      diagnosis.map((finding) =>
        finding.missIds.length === 1 && finding.missIds[0].startsWith('ASOP-233:T-23')
          ? { ...finding, causeClass: 'data' }
          : finding,
      ),
  },
  {
    name: 'miss-dropped',
    what: 'one miss quietly left out of the answer',
    why: 'a gap that goes unreported because nothing noticed it was missing — this app in miniature',
    mustFail: ['coverage'],
    build: (diagnosis) =>
      diagnosis.filter((finding) => !finding.missIds.includes('ASOP-455:M-0027')),
  },
];
