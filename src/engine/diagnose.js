// Diagnosis layer: misses in, findings out.
//
// The baselines in src/db/baselines.js answer "which candidates should have been picked up and
// were not". This answers the two questions after that, in order:
//
//   1. Which of these misses share a cause at all?
//   2. What is that cause, and which class does it belong to?
//
// Question 1 is the hard one and it is the reason this is a model call rather
// than a rules pass. Twenty-four misses do not arrive labelled with their
// groupings, and the number of ways to partition them is not something a
// predicate enumerates. Rules could be written to reproduce the answer for THIS
// data — they would be written knowing what was planted, which is exactly why
// reproducing it would prove nothing. The real system has around two hundred
// automations and nobody can enumerate their failure modes in advance.
//
// ONE CALL, NOT A CHAIN
//
// generate-sql.js is three stages because resolution, extraction and
// composition fail in three distinguishable ways and running them together
// blurs which one broke. Diagnosis does not decompose like that. Splitting it
// into "group the misses" then "classify each group" would let the second call
// rationalise the first one's grouping — it would arrive with the groups
// already fixed and its only remaining job would be to find words for them.
// The grouping IS the judgement being tested, so it is made once, with
// everything visible, and scored as one answer.
//
// WHAT THE MODEL IS GIVEN
//
// Every miss, with the full row its baseline returned. The definition of each
// automation's detection, taken from the baseline metadata: its shape, its
// condition in prose, its configs, its constrictions, its bypasses, the
// parameters its query binds and whether it joins the platform's availability
// record at all. And the platform_status table, which is where the outage is.
//
// The structural facts are in there because a correct answer has to be
// derivable from what is supplied, and for some of these misses the temporal
// evidence alone points the wrong way. They are stated as plain properties of
// each detection, in the same form for all seven, with nothing said about what
// follows from them. Handing over the inference as well as the evidence would
// make the answer a transcription.
//
// WHAT IT IS NOT GIVEN
//
// src/db/expected-findings.js, which is the answer. Nothing in this module
// imports it, the same way nothing in generate-sql.js imports baselines.js.
// Note also that the misses on ASOP-341 and ASOP-455 carry no platform status:
// their baselines do not join it, so there is none to carry, and attaching one
// here for symmetry would fabricate evidence — see the note on that join in
// baselines.js.
//
// KEY HANDLING
//
// Same key rule as generate-sql.js; see .env.example.
// The key is read from import.meta.env here too rather than imported, so this
// module stays loadable under plain Node; `client` and `call` are injectable
// for the same reason, and scripts/diagnose-check.mjs supplies both.

import Anthropic from '@anthropic-ai/sdk';
import { BASELINES, baselineParams } from '../db/baselines.js';
import { identityColumns, missId } from '../db/miss-id.js';
import { CAUSE_CLASSES } from '../db/cause-classes.js';
import { runQuery } from '../db/query.js';
import { ANALYSIS_END, WINDOW_START } from '../db/seed/index.js';
import { platformStatusWindows } from '../db/seed/platform.js';

export const MODEL = 'claude-opus-5';

const API_KEY = import.meta.env?.VITE_ANTHROPIC_API_KEY ?? '';

/** No key means no live diagnosis. This layer has no recorded path yet. */
export const isDemoMode = !API_KEY;

export const ANALYSIS_END_ISO = new Date(ANALYSIS_END).toISOString().replace('.000Z', 'Z');
export const WINDOW_START_ISO = new Date(WINDOW_START).toISOString().replace('.000Z', 'Z');

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

// -----------------------------------------------------------------------------
// Collecting the misses
// -----------------------------------------------------------------------------

// identityColumns and missId live in src/db/miss-id.js so browser code can use
// them without importing this module (and the model SDK it pulls in).
export { identityColumns, missId };

/** sql.js binds an empty object happily; passing nothing keeps the intent clear. */
function bindOf(params) {
  return params && Object.keys(params).length > 0 ? { params } : {};
}

/**
 * Run every baseline and return one record per miss.
 *
 * Throws if a baseline fails to run. That is a harness fault rather than a
 * finding about anything, and continuing would silently diagnose a subset.
 *
 * @param {object} db              a loaded sql.js database
 * @param {string} [analysisEnd]   the analysis window's closing edge
 * @param {object[]} [baselines]   defaults to all of them
 */
export function collectMisses(db, { analysisEnd = ANALYSIS_END_ISO, baselines = BASELINES } = {}) {
  const misses = [];

  for (const baseline of baselines) {
    const params = baselineParams(baseline, { analysisEnd });
    const run = runQuery(db, baseline.sql, bindOf(params));
    if (!run.ok) {
      throw new Error(`Baseline ${baseline.asopId} failed to run: ${run.error}`);
    }
    for (const row of run.rows) {
      misses.push({
        missId: missId(baseline, row),
        asopId: baseline.asopId,
        asopName: baseline.name,
        sponsor: baseline.sponsor,
        department: baseline.department,
        // The row exactly as the detection returned it, including its bypass
        // column and, where the detection joins one, its platform status.
        row,
      });
    }
  }

  return misses;
}

// -----------------------------------------------------------------------------
// The evidence bundle
// -----------------------------------------------------------------------------

/**
 * Does this detection consult the platform's availability record?
 *
 * Derived from the baseline's own SQL rather than declared, so it cannot drift
 * from what the query does. Reported as a property of the detection alongside
 * the parameters it binds; what follows from it is the reader's problem.
 */
function joinsPlatformStatus(baseline) {
  return /\bplatform_status\b/i.test(baseline.sql);
}

/**
 * One entry per ASOP: what its detection looks for and how it is bounded.
 *
 * Everything here comes from the baseline's declared metadata, which is the
 * automation's definition, not the answer to anything. `condition` is the
 * prose the baseline carries; configs, constrictions and bypasses pass through
 * unchanged, including the threshold histories — three ASOPs carry one and only
 * one of the three went unapplied, so a history is a fact and not a verdict.
 */
export function detectionCatalogue(baselines = BASELINES) {
  return baselines.map((baseline) => ({
    asopId: baseline.asopId,
    name: baseline.name,
    sponsor: baseline.sponsor,
    department: baseline.department,
    table: baseline.table,
    shape: baseline.shape,
    condition: baseline.condition,
    configs: baseline.configs,
    constrictions: baseline.constrictions,
    bypasses: baseline.bypasses.map((bypass) => ({
      name: bypass.name,
      clause: bypass.clause,
      note: bypass.note,
    })),
    identityColumns: identityColumns(baseline),
    parametersBound: baseline.params,
    joinsPlatformStatus: joinsPlatformStatus(baseline),
  }));
}

/**
 * Everything a diagnosis is allowed to reason from.
 *
 * @param {object} db
 * @param {string} [analysisEnd]
 */
export function buildEvidenceBundle(
  db,
  { analysisEnd = ANALYSIS_END_ISO, windowStart = WINDOW_START_ISO, baselines = BASELINES } = {},
) {
  const misses = collectMisses(db, { analysisEnd, baselines });
  return {
    analysisWindow: { start: windowStart, end: analysisEnd },
    platformStatus: platformStatusWindows,
    detections: detectionCatalogue(baselines),
    misses,
    missIds: misses.map((miss) => miss.missId),
  };
}

// -----------------------------------------------------------------------------
// The prompt
// -----------------------------------------------------------------------------

export const DIAGNOSE_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'One line naming the finding.',
          },
          causeClass: {
            type: 'string',
            enum: CAUSE_CLASSES,
            description: 'The class this cause belongs to.',
          },
          missIds: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
            description:
              'The misses this finding accounts for, by their exact missId from the bundle.',
          },
          cause: {
            type: 'string',
            description:
              'What went wrong, stated as a cause. For a finding covering more than one miss, why the same cause accounts for every one of them.',
          },
          evidence: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
            description:
              'The specific facts from the bundle this rests on. Quote values rather than describing them.',
          },
          confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
        },
        required: ['title', 'causeClass', 'missIds', 'cause', 'evidence', 'confidence'],
        additionalProperties: false,
      },
    },
    notes: {
      type: 'string',
      description:
        'Anything worth recording that is not a finding. Empty string if there is nothing.',
    },
  },
  required: ['findings', 'notes'],
  additionalProperties: false,
};

export const DIAGNOSE_SYSTEM_PROMPT = `You are an auditor working through the output of an independent reconciliation pass over an automation platform.

The pass has already established WHICH conditions the platform should have acted on and did not. That part is settled and is not up for revision — every miss you are given is real, and none of them is there in error. Your job is the next question: why, and which of these misses share a reason.

You produce FINDINGS. A finding groups one or more misses under a single cause.

WHAT A GROUPING CLAIMS

Putting two misses in one finding asserts that one cause produced both. That is a strong claim and it is the claim being judged. Misses that happened close together did not thereby share a cause; co-occurrence is something to explain, not an explanation. Before grouping, check that the cause you are proposing actually accounts for each miss in the group on its own terms — that it explains why THAT condition, under THAT automation's definition, went unselected. If it does not, they are separate findings, however similar they look.

The reverse error costs as well. Several misses that genuinely do share one cause are one finding and one fix, and splitting them into many buries that.

WHAT COUNTS AS A CAUSE

Something that accounts for the silence. The automation's own definition is in the bundle — what it looks for, what qualifies, what stands it down, how it is bounded, what it consults. So is the platform's availability record. A cause has to be consistent with all of that.

Note that a bypass never suppressed a miss here: this pass reports a bypassed candidate and attributes the reason onto it. When a miss carries a bypass, that reason is available to you as an explanation for why nothing fired. Whether it is a good reason is a separate question and sometimes the finding.

WHEN THERE IS NO CAUSE

Use "unexplained" and say so. It is a real answer and it is preferred over a cause the evidence does not carry. A finding you cannot support with specific values from the bundle is one you should not be making, and inventing one to avoid an unexplained miss is worse than the unexplained miss.

RULES

- Every missId in the bundle must appear in exactly one finding. None twice, none left out.
- Use missIds exactly as given. Do not shorten or reformat them.
- Cite specific values in "evidence" — timestamps, column values, configured numbers — not paraphrase.
- Set confidence honestly. Low confidence on a real observation is more useful than high confidence on a guess.`;

export function buildDiagnosePrompt(bundle) {
  return `An analysis window ran from ${bundle.analysisWindow.start} to ${bundle.analysisWindow.end}. ${bundle.misses.length} candidates qualified under ${bundle.detections.length} automations and were never selected by the platform.

## The automations

Each automation's detection, as defined. \`configs\` decide what qualifies. \`constrictions\` are business scoping rules. \`bypasses\` are conditions under which the automation stands down; this pass reports those candidates anyway and attributes the reason. \`parametersBound\` and \`joinsPlatformStatus\` describe how the detection query itself is written.

${JSON.stringify(bundle.detections, null, 2)}

## Platform availability

The platform is event-driven and performs no historical replay.

${JSON.stringify(bundle.platformStatus, null, 2)}

## The misses

Each carries the row its detection returned. \`bypass\` is non-null when a bypass applied. Fields differ between automations because the candidate types do.

${JSON.stringify(bundle.misses, null, 2)}

Group all ${bundle.misses.length} into findings.`;
}

// -----------------------------------------------------------------------------
// Transport
// -----------------------------------------------------------------------------

const MAX_TOKENS = 32000;
const EFFORT = 'high';

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: API_KEY, dangerouslyAllowBrowser: true });
  }
  return client;
}

/**
 * One model call under the diagnosis schema. Throws with a readable message.
 *
 * `client` is injectable for the same reason it is in generate-sql.js: this
 * module's key comes from import.meta.env, which is empty under plain Node, and
 * a check script that had to reimplement the call would not be checking this
 * module.
 *
 * STREAMED, unlike the three stages in generate-sql.js. This is one call over
 * every miss at once with a large output budget, and the SDK refuses a
 * non-streaming request whose max_tokens implies it could run past ten minutes.
 * `.finalMessage()` reassembles the whole response, so nothing downstream has
 * to know — the alternative was cutting the budget to stay under the threshold,
 * which would trade a transport detail for a truncated diagnosis.
 */
export async function callDiagnoseLive(userPrompt, { client: supplied = null } = {}) {
  const startedAt = Date.now();

  const stream = (supplied ?? getClient()).messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: DIAGNOSE_SYSTEM_PROMPT,
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: DIAGNOSE_SCHEMA },
    },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `The model declined the diagnosis (${response.stop_details?.category ?? 'no category given'}).`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'The diagnosis hit the token limit before it finished. Raise MAX_TOKENS in src/engine/diagnose.js.',
    );
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!text) throw new Error('The diagnosis returned no text content.');

  return {
    raw: text,
    source: 'live',
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    elapsedMs: Date.now() - startedAt,
  };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
//
// Structured outputs make the shape checks near-redundant, and they are here
// for the same reason parseGenerated() and parseComposed() are: the check
// belongs to this app rather than to the call, and has to survive a change of
// schema, model or transport.
//
// The partition rules go past what a schema can state. A diagnosis that drops a
// miss is the failure mode of this entire application in miniature — a gap that
// goes unreported because nothing noticed it was missing — so it is rejected
// here rather than scored later. src/engine/diagnose-score.js checks the same
// property again independently, on the same principle as the house rules being
// enforced both before a generated query runs and after.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: `Response is not valid JSON: ${error.message}` };
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validate a raw diagnosis against the bundle it was produced from.
 *
 * @param {string}   raw          the model's JSON text
 * @param {string[]} knownMissIds every missId in the bundle
 */
export function parseDiagnosis(raw, { knownMissIds }) {
  const errors = [];
  const warnings = [];

  const parsed = parseJson(raw);
  if (!parsed.ok) return { ok: false, value: null, errors: [parsed.error], warnings };

  const value = parsed.value;
  if (!isObject(value)) {
    return { ok: false, value: null, errors: ['Response must be a JSON object'], warnings };
  }
  if (!Array.isArray(value.findings) || value.findings.length === 0) {
    return { ok: false, value: null, errors: ['findings: must be a non-empty array'], warnings };
  }

  const known = new Set(knownMissIds);
  const seen = new Map();

  value.findings.forEach((finding, index) => {
    const at = `findings[${index}]`;
    if (!isObject(finding)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (!nonEmptyString(finding.title)) errors.push(`${at}.title: must be a non-empty string`);
    if (!nonEmptyString(finding.cause)) errors.push(`${at}.cause: must be a non-empty string`);
    if (!CAUSE_CLASSES.includes(finding.causeClass)) {
      errors.push(
        `${at}.causeClass: ${JSON.stringify(finding.causeClass)} is not one of ${CAUSE_CLASSES.join(', ')}`,
      );
    }
    if (finding.confidence !== undefined && !CONFIDENCE_LEVELS.includes(finding.confidence)) {
      errors.push(`${at}.confidence: must be one of ${CONFIDENCE_LEVELS.join(', ')}`);
    }
    if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
      errors.push(`${at}.evidence: must be a non-empty array`);
    }

    if (!Array.isArray(finding.missIds) || finding.missIds.length === 0) {
      errors.push(`${at}.missIds: must be a non-empty array`);
      return;
    }
    for (const id of finding.missIds) {
      if (!known.has(id)) {
        errors.push(`${at}.missIds: ${JSON.stringify(id)} is not a miss in this bundle`);
        continue;
      }
      if (seen.has(id)) {
        errors.push(`${at}.missIds: ${id} already appears in findings[${seen.get(id)}]`);
        continue;
      }
      seen.set(id, index);
    }
  });

  // A dropped miss is the one failure this pass exists to prevent, so it stops
  // the diagnosis rather than being reported as a shortfall in it.
  const uncovered = knownMissIds.filter((id) => !seen.has(id));
  if (uncovered.length > 0) {
    errors.push(
      `${uncovered.length} miss(es) appear in no finding: ${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', …' : ''}`,
    );
  }

  if (typeof value.notes !== 'string') warnings.push('notes: missing or not a string');

  if (errors.length > 0) return { ok: false, value: null, errors, warnings };

  return {
    ok: true,
    value: {
      findings: value.findings.map((finding) => ({
        title: finding.title,
        causeClass: finding.causeClass,
        missIds: finding.missIds,
        cause: finding.cause,
        evidence: finding.evidence,
        confidence: finding.confidence ?? null,
      })),
      notes: typeof value.notes === 'string' ? value.notes : '',
    },
    errors,
    warnings,
  };
}

// -----------------------------------------------------------------------------

/**
 * Diagnose one evidence bundle.
 *
 * Never throws. A transport failure and a validation failure both come back as
 * `ok: false` with whatever is known attached, for the same reason generateSql
 * does it: the partial result is most of the diagnosis of the diagnosis.
 *
 * `call` replaces the transport, and defaults to the live path using this
 * module's own key.
 */
export async function diagnose({ bundle, call = null }) {
  const prompt = buildDiagnosePrompt(bundle);
  const transport = call ?? ((userPrompt) => callDiagnoseLive(userPrompt));

  let response;
  try {
    response = await transport(prompt);
  } catch (error) {
    return { ok: false, prompt, call: null, findings: null, errors: [error.message], warnings: [] };
  }

  const parsed = parseDiagnosis(response.raw, { knownMissIds: bundle.missIds });

  return {
    ok: parsed.ok,
    prompt,
    call: response,
    findings: parsed.value?.findings ?? null,
    notes: parsed.value?.notes ?? '',
    errors: parsed.errors,
    warnings: parsed.warnings,
  };
}
