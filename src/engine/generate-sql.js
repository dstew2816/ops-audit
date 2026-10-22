// SQL generation layer: process documentation in, executable detection SQL out.
//
// This module has to produce the detector itself, because there is no single
// detector to configure. Six candidate types with six sets of time semantics do
// not reduce to one parameterised query — see the header of src/db/baselines.js.
//
// THREE STAGES, THREE SEPARATE FAILURE MODES
//
//   1. resolve   Which ASOP is this document about? Roster of id, name,
//                sponsor and department, and the document. Nothing else.
//   2. extract   What does the document say the condition is? Document plus
//                the raw schema, no shape hints. Table, threshold, configs,
//                constrictions and bypasses come out.
//   3. compose   Write the SQL. Takes the resolved id and the extracted spec.
//
// They are separate because they fail differently and a single call would blur
// that. A wrong resolution in stage 1 produces SQL that is internally perfect
// and anti-joins against another ASOP's log rows, which returns every candidate
// as a miss — loud, and nothing to do with the SQL. A wrong table in stage 2
// produces a query that runs and finds the wrong kind of thing. A wrong clause
// in stage 3 is an ordinary bug. Run together, all three present as "the
// numbers are off".
//
// STAGE 3 NEVER SEES THE DOCUMENT
//
// Deliberately. The spec from stage 2 is the entire interface, so anything
// stage 2 failed to extract cannot reappear in the SQL by luck. That is what
// makes stage 2 falsifiable rather than decorative.
//
// THE RESOLVED ID IS THE ANTI-JOIN SCOPE
//
// Every anti-join is scoped by asop_id because $.tool_id appears in the port,
// tool and check payloads and $.batch_id appears in batch and hold payloads —
// the extracted key alone over-matches. Stage 1 choosing ASOP-118 for a
// document about ASOP-114 does not produce a near miss; it produces a query
// that matches no log rows at all and reports 100% failure.
//
// BYPASSES INVERT HERE. THIS IS THE NOTE src/db/templates.js POINTS AT.
//
// The documents state bypasses as suppression, because in the automation that
// is what they are: "we don't restart a port that's in maintenance mode" means
// the automation stands down. An audit layer that copied that sentence into a
// WHERE clause would inherit the exact blind spot it exists to find — the port
// was still blocked, nothing was done about it, and the report would be silent.
//
// So a bypass is inverted on the way in: it becomes a CASE expression in the
// SELECT list that attributes the reason onto the row, and the row is still
// returned. A config is the opposite — it decides what qualifies at all, and
// something that fails it was never a candidate. A constriction is a business
// scoping rule, also suppressing, and also not derivable from the data. The
// prompts below draw that distinction explicitly and parseComposed() enforces
// it, because it is the one mistake that would quietly hollow out the report.
//
// GROUND TRUTH NEVER ENTERS A PROMPT
//
// Nothing here imports src/db/baselines.js. The roster is projected from the
// registry in the seed layer down to id, name, sponsor and department, and the
// schema catalogue is the CREATE TABLE text with no commentary attached.
// Whatever the baselines happen to say about a candidate type is the answer,
// not the question.
//
// KEY HANDLING
//
// The key is read from import.meta.env, which is empty under plain Node;
// scripts/gen-check.mjs builds its own client from the shell environment and
// injects it. Explicit .js extensions and `import.meta.env?.` keep this module
// loadable under plain Node. See .env.example for why a key must never be present
// in a build that is published.

import Anthropic from '@anthropic-ai/sdk';
import { ASOPS, ANALYSIS_END } from '../db/seed/index.js';
// Keys only. The summaries in CANDIDATE_TABLES describe each candidate type's
// detection semantics, which is precisely what stage 2 is supposed to derive
// from the document — handing them over would answer the question.
import { DDL, CANDIDATE_TABLES } from '../db/schema.js';
// The rules the composed SQL has to follow, shared with the baseline harness
// and the scorer so that a rule cannot be enforced in one place and quietly
// relaxed in another.
import {
  ANTI_JOIN_FILTER,
  attributesBypass,
  bypassColumn,
  filterLinesMentioning,
  hasBypassColumn,
  isAntiJoinFilter,
  outerFilter,
} from '../db/house-rules.js';
import { hashText } from './hash.js';

export const MODEL = 'claude-opus-5';

const API_KEY = import.meta.env?.VITE_ANTHROPIC_API_KEY ?? '';

/** No key means no live generation. Recorded responses only. */
export const isDemoMode = !API_KEY;

/** The analysis window's closing edge, in the same fixed-width form as the data. */
export const ANALYSIS_END_ISO = new Date(ANALYSIS_END).toISOString().replace('.000Z', 'Z');

export const STAGES = ['resolve', 'extract', 'compose'];

// -----------------------------------------------------------------------------
// Reference material handed to the model
// -----------------------------------------------------------------------------

/**
 * The ASOP roster, projected down to what a person going through a filing
 * cabinet would have: an id, a registered name, and who owns it.
 *
 * `table` and `payloadKey` are in the registry and are dropped here on purpose.
 * Resolution is supposed to be an act of comprehension, and the templates never
 * reproduce a registered name verbatim for the same reason.
 *
 * Sponsor is a weak signal by construction: p.varghese owns ASOP-233 and
 * ASOP-402, r.lindqvist owns ASOP-207 and ASOP-455, and ASOP-114 and ASOP-118
 * share both a sponsor and a department, so for that pair the owner line
 * carries no information at all.
 */
export const ASOP_ROSTER = Object.entries(ASOPS).map(([asopId, asop]) => ({
  asopId,
  name: asop.name,
  sponsor: asop.sponsor,
  department: asop.department,
}));

export const ASOP_IDS = ASOP_ROSTER.map((asop) => asop.asopId);

export const CANDIDATE_TABLE_NAMES = Object.keys(CANDIDATE_TABLES);

export const SHAPES = [
  'interval',
  'countdown',
  'unplanned-window',
  'null-check',
  'absence',
  'retry-chain',
];

/**
 * What asop_activity_log.selection_payload holds, per table. This is the log's
 * documented contract — the columns and values an automation grabbed while
 * selecting its candidate — and any engineer writing an anti-join by hand would
 * have it in front of them.
 *
 * Note what it does not settle: which subset of a payload identifies a
 * candidate uniquely, and the fact that $.tool_id and $.batch_id each appear
 * under more than one table. Both are still the model's problem.
 */
export const PAYLOAD_SHAPES = {
  port_state_history: ['port_id', 'tool_id', 'state', 'entered_at'],
  batch_queue_events: ['batch_id', 'step_id', 'queue_deadline'],
  tool_status_log: ['tool_id', 'status', 'status_start', 'reason_code'],
  hold_records: ['hold_id', 'batch_id', 'dept_code', 'memo'],
  scheduled_checks: ['check_id', 'tool_id', 'due_at'],
  email_queue: ['message_id', 'recipient_group', 'attempts'],
};

/** The CREATE TABLE statement for one table, straight out of the schema. */
function ddlFor(table) {
  const pattern = new RegExp(`^\\s*CREATE TABLE ${table}\\s*\\(`);
  return DDL.find((statement) => pattern.test(statement)) ?? '';
}

/** Every candidate table's DDL, and the two supporting tables. */
function schemaCatalogue() {
  return [...CANDIDATE_TABLE_NAMES, 'asop_activity_log', 'platform_status']
    .map((table) => ddlFor(table).trim())
    .join(';\n\n');
}

const ROSTER_TEXT = ASOP_ROSTER.map(
  (asop) => `  ${asop.asopId}  ${asop.name}  —  ${asop.sponsor}, ${asop.department}`,
).join('\n');

const PAYLOAD_TEXT = Object.entries(PAYLOAD_SHAPES)
  .map(([table, keys]) => `  ${table.padEnd(20)} {${keys.map((k) => `"${k}"`).join(',')}}`)
  .join('\n');

// -----------------------------------------------------------------------------
// Stage 1 — resolve
// -----------------------------------------------------------------------------

export const RESOLVE_SCHEMA = {
  type: 'object',
  properties: {
    asopId: {
      type: 'string',
      enum: ASOP_IDS,
      description: 'The ASOP this document describes.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description:
        'How well the document distinguishes this ASOP from the rest of the roster.',
    },
    quoted_condition: {
      type: 'string',
      description:
        'A short quote from the document that states the condition being watched and its threshold, in the original wording.',
    },
  },
  required: ['asopId', 'confidence', 'quoted_condition'],
  additionalProperties: false,
};

export const RESOLVE_SYSTEM_PROMPT = `You identify which registered automation a piece of internal process documentation describes.

You are given a roster of automations and one document. The document is a real internal artefact — a wiki page, a forwarded email thread, an SOP — written by people who already know which process they are talking about. It will not name the automation, and it will not reproduce the registered name.

Resolve on what the document is ABOUT: the condition it describes, the thing that condition is observed on, and what the automation is supposed to do about it.

Rules:
- Read the whole document before deciding. The distinguishing detail is often a threshold or a state named in passing.
- Sponsor and department are weak evidence. Several sponsors own more than one automation, ownership lines go stale, and two entries on the roster share both. An owner line can never settle it on its own.
- Two roster entries can cover the same kind of equipment and differ only in the condition they watch for and how long they wait. Where that is the case, the condition and the threshold are the discriminator, not the subject matter.
- If the document genuinely does not distinguish between two entries, pick the better fit and mark confidence low.`;

export function buildResolvePrompt(templateText) {
  return `Roster of registered automations:

${ROSTER_TEXT}

Identify which one the document below describes.

<document>
${templateText}
</document>`;
}

// -----------------------------------------------------------------------------
// Stage 2 — extract
// -----------------------------------------------------------------------------

export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    table: {
      type: 'string',
      enum: CANDIDATE_TABLE_NAMES,
      description: 'The table holding the things this automation evaluates.',
    },
    shape: {
      type: 'string',
      enum: SHAPES,
      description:
        'How qualification is measured. interval: elapsed time between two edges on a row. countdown: time remaining against a fixed deadline, may be negative. unplanned-window: an interval, once planned work has been removed. null-check: a column is empty, with no time involved. absence: something came due and its counterpart was never written. retry-chain: a counter passed a ceiling.',
    },
    qualifyingCondition: {
      type: 'string',
      description: 'The full test a row must pass to be a candidate, in one or two sentences.',
    },
    thresholdValue: {
      type: ['integer', 'null'],
      description: 'The numeric threshold, converted to the unit below. Null if there is none.',
    },
    thresholdUnit: {
      type: 'string',
      enum: ['minutes', 'count', 'none'],
      description: 'What the threshold is measured in.',
    },
    thresholdMeaning: {
      type: 'string',
      enum: [
        'elapsed-in-state',
        'remaining-until-deadline',
        'overdue-past-due',
        'attempt-count',
        'none',
      ],
      description:
        'What the number means. Elapsed time and time remaining are not the same quantity and are not interchangeable.',
    },
    timePredicate: {
      type: 'string',
      enum: ['required', 'none'],
      description:
        "Whether qualification depends on time at all. 'none' means the detection has no duration, no threshold in time, and no window bound — timestamps on the row may still exist and are then evidence only.",
    },
    openIntervals: {
      type: 'string',
      enum: ['close-at-analysis-end', 'not-applicable'],
      description:
        'How an interval that has not closed yet is treated. Not applicable when the shape has no interval.',
    },
    configs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          expression: {
            type: 'string',
            description: 'The condition in terms of the actual columns, e.g. "state = \'blocked\'".',
          },
          note: { type: 'string', description: 'Where the document says this.' },
        },
        required: ['name', 'expression', 'note'],
        additionalProperties: false,
      },
      description:
        'Parts of the condition. A row failing one of these was never a candidate. Empty array if none.',
    },
    constrictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          expression: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['name', 'expression', 'note'],
        additionalProperties: false,
      },
      description:
        'Business scoping rules — these departments, that equipment class, this location range. Somebody decided them; they do not follow from the data. They narrow what the automation is responsible for. Empty array if none.',
    },
    bypasses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          expression: {
            type: 'string',
            description:
              'The condition identifying a bypassed candidate, in terms of the actual columns.',
          },
          note: { type: 'string', description: 'The reason, as the document gives it.' },
        },
        required: ['name', 'expression', 'note'],
        additionalProperties: false,
      },
      description:
        'Reasons the automation stands down from a candidate that DID qualify. Empty array if none.',
    },
    notes: {
      type: 'string',
      description:
        'Anything superseded, contradictory, stated twice in different units, or ambiguous, and the reading you took. Empty string if the document was clear.',
    },
  },
  required: [
    'table',
    'shape',
    'qualifyingCondition',
    'thresholdValue',
    'thresholdUnit',
    'thresholdMeaning',
    'timePredicate',
    'openIntervals',
    'configs',
    'constrictions',
    'bypasses',
    'notes',
  ],
  additionalProperties: false,
};

export const EXTRACT_SYSTEM_PROMPT = `You read internal process documentation and state, precisely and in terms of a database schema, what condition the automation it describes is looking for.

You get the document and the schema. Nothing tells you which table is the right one or how that table's detection is meant to work — that is what you are working out.

The documents are real internal notes, not specifications. Expect mixed languages, a superseded value left inline beside the current one, a threshold stated twice in different units, a scoping rule buried in a parenthetical, and references to attachments that are not there. Read all of it before deciding any field.

Rules:
- Where a value has been revised, take the current one. Change notes and revision histories tell you which is which.
- Convert every duration to whole minutes.
- Elapsed time, time remaining against a deadline, and time overdue past a due point are three different quantities. Say which one the document means; a countdown is not a duration and goes negative.
- Some detections have no time element whatsoever. A table having timestamps does not mean the condition uses them. If the document says the wait does not matter, timePredicate is none and there is no window, threshold or date filter, however many date columns the table has.
- Separate three kinds of rule, because they behave differently downstream:
  - A CONFIG is part of the condition. A row failing it was never a candidate.
  - A CONSTRICTION is a business scoping rule — a range of equipment, a set of departments, a bay. Nobody derived it from the data; somebody decided it. It also narrows the candidate set.
  - A BYPASS is a reason the automation stands down from something that DID qualify. Documents write these as suppression, because in the automation they suppress: "we don't act on X", "we leave those alone", "the reason is taken as sufficient". Record them as bypasses, with the condition that identifies them. They are the reason nothing happened, and something still should have.
  Where the document phrases a rule as a carve-out, decide which it is by asking whether the thing was ever a candidate. Planned work booked in advance is not a defect and never qualified: config. A defect somebody has a reason not to chase is still a defect: bypass.
- Write expressions against the real column names in the schema.
- Report what the document says, not what a sensible automation would do. If it describes something odd, extract it as written and say so in notes.`;

export function buildExtractPrompt(templateText) {
  return `Schema:

${schemaCatalogue()}

State the detection condition the document below describes, against that schema.

<document>
${templateText}
</document>`;
}

// -----------------------------------------------------------------------------
// Stage 3 — compose
// -----------------------------------------------------------------------------

export const COMPOSE_SCHEMA = {
  type: 'object',
  properties: {
    sql: {
      type: 'string',
      description: 'One SQLite SELECT statement, no trailing semicolon.',
    },
    antiJoinKeys: {
      type: 'array',
      items: { type: 'string' },
      description:
        "The json_extract paths the anti-join matches on, e.g. [\"$.port_id\", \"$.entered_at\"].",
    },
    usesAnalysisEnd: {
      type: 'boolean',
      description: 'Whether the query binds $end. False when the condition has no time dimension.',
    },
    notes: {
      type: 'string',
      description:
        'Anything the spec left underdetermined and how you resolved it. Empty string if nothing.',
    },
  },
  required: ['sql', 'antiJoinKeys', 'usesAnalysisEnd', 'notes'],
  additionalProperties: false,
};

export const COMPOSE_SYSTEM_PROMPT = `You write one SQLite query that finds the candidates an automation should have picked up and did not.

The automation platform is event-driven and has no historical replay. When it was down, or an event reached it after the condition had cleared, nothing fired — and nothing was written in the system that failed. Your query is the independent pass that reconstructs the candidates from the source tables and anti-joins them against the platform's activity log. The log holds only the candidates that WERE picked up; a missed one has no row there at all. That absence is the entire signal.

STRUCTURE

  WITH qualifying AS ( ... )        the candidate set, in its own shape
  SELECT ... FROM qualifying q
  LEFT JOIN asop_activity_log l ON l.asop_id = '<the id you are given>'
    AND json_extract(l.selection_payload, '$.<key>') = q.<column>   [one per key]
  LEFT JOIN platform_status ps ON ps.window_start <= q.<ts> AND ps.window_end > q.<ts>
  WHERE l.log_id IS NULL
  ORDER BY <something stable>

CONVENTIONS

- Alias the qualifying set q and the activity log l. Both are required.
- The outer filter is exactly "WHERE l.log_id IS NULL" and nothing else. Every condition that decides what qualifies belongs inside the CTE.
- Scope the anti-join by asop_id as well as by the extracted key. $.tool_id appears in three payload shapes and $.batch_id in two, so the key alone matches other automations' rows.
- Timestamps are fixed-width ISO-8601 UTC text, so plain string comparison is a valid range filter. Durations in minutes are (julianday(b) - julianday(a)) * 1440. ROUND() them in the SELECT list, never inside a comparison.
- $end is the only parameter available and holds the end of the analysis window. Use it only if the condition needs that edge — to close an open interval, or to bound what has come due. A condition with no time dimension takes no parameter.
- Join platform_status only when the candidate has a timestamp that locates it in time. If it does not, leave the join out rather than inventing a timestamp to join on.
- Select the columns that evidence the finding: the identifiers, the quantity that qualified it, and the timestamps if there are any. No LIMIT. One statement. Read only.

BYPASSES ARE ATTRIBUTED, NEVER APPLIED

A bypass is the reason the automation stood down from a candidate that qualified. The candidate qualified anyway and nothing was done about it, so it is a finding and it must be returned.

Put every bypass in the SELECT list as a CASE expression that labels the row:

  CASE WHEN q.<column> <test> THEN '<short reason>' END AS bypass

aliased "bypass". If the spec declares no bypasses, select "NULL AS bypass" so the column is always there. A bypass condition must never appear in any WHERE clause. Filtering those rows out would make this pass blind to exactly the cases the platform was blind to, which is the one thing it exists to catch.

Configs and constrictions are the opposite: they decide what qualifies, so they belong in the CTE's WHERE.`;

export function buildComposePrompt({ asopId, spec }) {
  const table = spec.table;
  const payload = PAYLOAD_SHAPES[table] ?? [];

  const list = (entries, empty) =>
    entries.length === 0
      ? `  (${empty})`
      : entries.map((e) => `  - ${e.name}: ${e.expression}\n    ${e.note}`).join('\n');

  return `Automation: ${asopId}

Candidate table:

${ddlFor(table).trim()}

Its selection_payload in asop_activity_log carries these keys:

  {${payload.map((k) => `"${k}"`).join(',')}}

Pick the subset that identifies one candidate exactly. For a condition measured
over an interval, the identifier alone is not enough — the same subject can
qualify more than once — so the payload carries the interval's start as well.

Supporting tables:

${ddlFor('asop_activity_log').trim()}

${ddlFor('platform_status').trim()}

DETECTION SPEC

Shape: ${spec.shape}
Condition: ${spec.qualifyingCondition}
Threshold: ${
    spec.thresholdValue === null
      ? 'none'
      : `${spec.thresholdValue} ${spec.thresholdUnit} (${spec.thresholdMeaning})`
  }
Time predicate: ${spec.timePredicate}
Open intervals: ${spec.openIntervals}

Configs — part of the condition:
${list(spec.configs, 'none')}

Constrictions — business scoping, also narrowing:
${list(spec.constrictions, 'none')}

Bypasses — attributed onto the row, never filtered on:
${list(spec.bypasses, 'none declared: select NULL AS bypass')}
${spec.notes ? `\nExtraction notes: ${spec.notes}` : ''}

Write the query.`;
}

// -----------------------------------------------------------------------------
// Stage table
// -----------------------------------------------------------------------------

// max_tokens is generous because thinking is on by default on this model and
// shares the budget with the response. Compose gets the most: it is the only
// stage whose output is more than a few hundred tokens of JSON.
export const STAGE_SPECS = {
  resolve: {
    stage: 'resolve',
    label: 'Resolve the ASOP',
    system: RESOLVE_SYSTEM_PROMPT,
    schema: RESOLVE_SCHEMA,
    effort: 'high',
    maxTokens: 6000,
  },
  extract: {
    stage: 'extract',
    label: 'Extract the condition',
    system: EXTRACT_SYSTEM_PROMPT,
    schema: EXTRACT_SCHEMA,
    effort: 'high',
    maxTokens: 8000,
  },
  compose: {
    stage: 'compose',
    label: 'Compose the SQL',
    system: COMPOSE_SYSTEM_PROMPT,
    schema: COMPOSE_SCHEMA,
    effort: 'high',
    maxTokens: 12000,
  },
};

// -----------------------------------------------------------------------------
// Transport
// -----------------------------------------------------------------------------

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: API_KEY,
      // Required for direct browser calls, and safe only because this path runs
      // in local development. See .env.example.
      dangerouslyAllowBrowser: true,
    });
  }
  return client;
}

/**
 * One model call under one stage's schema. Throws with a readable message.
 *
 * `client` is injectable because this module's key comes from import.meta.env,
 * which is empty under plain Node — scripts/gen-check.mjs builds its own client
 * from the shell environment and passes it in. The alternative would be a
 * second copy of the chain in the script, which is the thing worth avoiding:
 * a check of the generation layer that does not run the generation layer.
 */
export async function callStageLive(stage, userPrompt, { client: supplied = null } = {}) {
  const spec = STAGE_SPECS[stage];
  if (!spec) throw new Error(`Unknown stage: ${stage}`);

  const startedAt = Date.now();

  const response = await (supplied ?? getClient()).messages.create({
    model: MODEL,
    max_tokens: spec.maxTokens,
    system: spec.system,
    output_config: {
      effort: spec.effort,
      format: { type: 'json_schema', schema: spec.schema },
    },
    messages: [{ role: 'user', content: userPrompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `The model declined the ${stage} stage (${response.stop_details?.category ?? 'no category given'}).`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `The ${stage} stage hit the token limit before it finished. Raise maxTokens for that stage in src/engine/generate-sql.js.`,
    );
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!text) throw new Error(`The ${stage} stage returned no text content.`);

  return {
    stage,
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

/**
 * A recorded response for one stage, or null.
 *
 * Recordings are keyed by template and stage and bound to a hash of the
 * COMPOSED USER PROMPT rather than of the template text. That is stricter than
 * it looks and it is the point: stage 2's and stage 3's prompts contain the
 * previous stages' output, so a replay that diverged anywhere upstream produces
 * a different prompt and stops matching here. The chain validates itself.
 *
 * `recordings` is passed in rather than imported so this module stays loadable
 * without a fixtures file. In demo mode with none supplied, generateSql()
 * reports that plainly instead of guessing.
 */
export function recordedFor(recordings, stage, templateId, userPrompt) {
  const record = recordings?.[`${templateId}:${stage}`];
  if (!record) return null;
  if (record.promptHash !== hashText(userPrompt)) return null;
  return {
    stage,
    raw: record.raw,
    source: 'recorded',
    model: record.model,
    usage: record.usage,
    elapsedMs: record.elapsedMs,
    recordedAt: record.recordedAt,
  };
}

/** One stage, live or replayed. Picks the path and says so when it cannot run. */
export async function callStage(stage, { templateId, userPrompt, recordings = null }) {
  if (!isDemoMode) return callStageLive(stage, userPrompt);

  const recorded = recordedFor(recordings, stage, templateId, userPrompt);
  if (recorded) return recorded;

  throw new Error(
    `Demo mode replays recorded responses. There is none for ${templateId} at the ${stage} stage matching this prompt — either the template was edited, an earlier stage came out differently, or nothing has been recorded yet. Live generation needs VITE_ANTHROPIC_API_KEY.`,
  );
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
//
// Structured outputs make the happy path here near-redundant, but the check
// belongs to this app, not to the generation call, and it has to survive a
// change of schema, model or transport. Stage 3 goes further than shape-checking — it enforces the
// house rules the SQL has to follow to mean anything, and those no schema can
// express.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: `Response is not valid JSON: ${error.message}` };
  }
}

function result(value, errors, warnings = []) {
  return { ok: errors.length === 0, value: errors.length === 0 ? value : null, errors, warnings };
}

/** Rule entries: {name, expression, note}, all present, expression non-empty. */
function checkRuleList(value, field, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field}: must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    if (!isObject(entry)) {
      errors.push(`${field}[${index}]: must be an object`);
      return;
    }
    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      errors.push(`${field}[${index}].name: missing or empty`);
    }
    if (typeof entry.expression !== 'string' || !entry.expression.trim()) {
      errors.push(`${field}[${index}].expression: missing or empty`);
    }
  });
}

export function parseResolved(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return result(null, [parsed.error]);
  const value = parsed.value;
  if (!isObject(value)) return result(null, ['Response is not a JSON object.']);

  const errors = [];
  const warnings = [];

  if (!ASOP_IDS.includes(value.asopId)) {
    errors.push(`asopId: must be one of the roster (got ${JSON.stringify(value.asopId)})`);
  }
  if (!['high', 'medium', 'low'].includes(value.confidence)) {
    errors.push(`confidence: must be high, medium or low (got ${JSON.stringify(value.confidence)})`);
  }
  if (typeof value.quoted_condition !== 'string' || !value.quoted_condition.trim()) {
    errors.push('quoted_condition: missing or empty');
  }
  if (value.confidence === 'low') {
    warnings.push('confidence: low — the document may not distinguish this ASOP from its neighbour');
  }

  return result(value, errors, warnings);
}

export function parseSpec(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return result(null, [parsed.error]);
  const value = parsed.value;
  if (!isObject(value)) return result(null, ['Response is not a JSON object.']);

  const errors = [];
  const warnings = [];

  if (!CANDIDATE_TABLE_NAMES.includes(value.table)) {
    errors.push(
      `table: must be one of ${CANDIDATE_TABLE_NAMES.join(', ')} (got ${JSON.stringify(value.table)})`,
    );
  }
  if (!SHAPES.includes(value.shape)) {
    errors.push(`shape: must be one of ${SHAPES.join(', ')} (got ${JSON.stringify(value.shape)})`);
  }
  if (typeof value.qualifyingCondition !== 'string' || !value.qualifyingCondition.trim()) {
    errors.push('qualifyingCondition: missing or empty');
  }
  if (value.thresholdValue !== null && !Number.isInteger(value.thresholdValue)) {
    errors.push(
      `thresholdValue: must be a whole number or null (got ${JSON.stringify(value.thresholdValue)})`,
    );
  }
  if (!['minutes', 'count', 'none'].includes(value.thresholdUnit)) {
    errors.push(`thresholdUnit: must be minutes, count or none (got ${JSON.stringify(value.thresholdUnit)})`);
  }
  if (!['required', 'none'].includes(value.timePredicate)) {
    errors.push(`timePredicate: must be required or none (got ${JSON.stringify(value.timePredicate)})`);
  }
  if (!['close-at-analysis-end', 'not-applicable'].includes(value.openIntervals)) {
    errors.push(`openIntervals: must be close-at-analysis-end or not-applicable`);
  }

  checkRuleList(value.configs, 'configs', errors);
  checkRuleList(value.constrictions, 'constrictions', errors);
  checkRuleList(value.bypasses, 'bypasses', errors);

  // Internal consistency. These check the spec against itself, never against
  // what the right answer happens to be — an extraction that is wrong but
  // coherent has to pass here and fail on the numbers.
  if (value.thresholdUnit === 'none' && value.thresholdValue !== null) {
    errors.push('thresholdValue: given a value while thresholdUnit is none');
  }
  if (value.thresholdUnit !== 'none' && value.thresholdValue === null) {
    errors.push(`thresholdValue: null while thresholdUnit is ${value.thresholdUnit}`);
  }
  if (value.thresholdUnit === 'minutes' && value.timePredicate === 'none') {
    errors.push('timePredicate: none, but the threshold is measured in minutes');
  }
  if (value.timePredicate === 'none' && value.openIntervals !== 'not-applicable') {
    errors.push('openIntervals: a detection with no time predicate has no open intervals to close');
  }
  if (value.thresholdMeaning === 'none' && value.thresholdValue !== null) {
    warnings.push('thresholdMeaning: none, but a threshold value was given');
  }

  return result(value, errors, warnings);
}

const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE\s+(?!TEMP)|ATTACH|DETACH|REPLACE|VACUUM)\b/i;

/**
 * Shape-check the composed SQL, then check it against the house rules.
 *
 * The rules enforced here are the same ones scripts/db-check.mjs enforces on
 * the hand-written baselines, applied to generated SQL before it is ever run.
 * The bypass rule in particular cannot wait for execution: a query that filters
 * its bypassed candidates out runs perfectly, returns a plausible number, and
 * is silently missing the findings that most needed reporting.
 */
export function parseComposed(raw, { asopId, spec }) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return result(null, [parsed.error]);
  const value = parsed.value;
  if (!isObject(value)) return result(null, ['Response is not a JSON object.']);

  const errors = [];
  const warnings = [];

  if (typeof value.sql !== 'string' || !value.sql.trim()) {
    return result(null, ['sql: missing or empty']);
  }
  const sql = value.sql.trim();

  // --- it has to be one readable statement -------------------------------
  if (!/^\s*(WITH|SELECT)\b/i.test(sql)) {
    errors.push('sql: must begin with WITH or SELECT');
  }
  if (WRITE_KEYWORDS.test(sql)) {
    errors.push('sql: contains a write or DDL keyword');
  }
  if (sql.replace(/;\s*$/, '').includes(';')) {
    errors.push('sql: more than one statement');
  }

  // --- it has to be an anti-join against the log, scoped by ASOP ----------
  if (!sql.includes('asop_activity_log')) {
    errors.push('sql: does not join asop_activity_log, so it is not an anti-join');
  }
  if (!sql.includes(`'${asopId}'`)) {
    errors.push(
      `sql: does not scope the join by asop_id = '${asopId}'. The payload keys are shared between ASOPs, so an unscoped join matches other automations' rows.`,
    );
  }
  if (!/json_extract\s*\(/i.test(sql)) {
    errors.push('sql: does not extract from selection_payload');
  }

  // --- the outer filter is the anti-join and nothing else -----------------
  const outerWhere = outerFilter(sql);
  if (!outerWhere) {
    errors.push('sql: no WHERE clause, so nothing is being anti-joined');
  } else if (!isAntiJoinFilter(outerWhere)) {
    errors.push(
      `sql: the outer filter must be exactly "${ANTI_JOIN_FILTER}" (got "${outerWhere}"). Anything else drops qualifying candidates after the fact.`,
    );
  }

  // --- bypasses are attributed, never applied ----------------------------
  if (!hasBypassColumn(sql)) {
    errors.push('sql: no column aliased "bypass". Select NULL AS bypass when there are none.');
  }
  for (const bypass of spec.bypasses ?? []) {
    const column = bypassColumn(bypass.expression);
    if (!column) continue;

    if (!attributesBypass(sql, column)) {
      errors.push(
        `sql: bypass "${bypass.name}" is not attributed. It has to appear as a CASE expression on ${column} in the SELECT list.`,
      );
    }

    const filtered = filterLinesMentioning(sql, column);
    if (filtered.length > 0) {
      errors.push(
        `sql: bypass "${bypass.name}" is being filtered on — ${column} appears in "${filtered[0]}". A bypassed candidate still qualified and still has to be returned.`,
      );
    }
  }

  // --- the parameter has to match what the SQL actually uses --------------
  const bindsEnd = sql.includes('$end');
  if (typeof value.usesAnalysisEnd === 'boolean' && value.usesAnalysisEnd !== bindsEnd) {
    warnings.push(
      `usesAnalysisEnd: declared ${value.usesAnalysisEnd}, but the SQL ${bindsEnd ? 'does' : 'does not'} reference $end. The binding follows the SQL.`,
    );
  }
  if (bindsEnd && spec.timePredicate === 'none') {
    warnings.push(
      'sql: binds $end although the extracted spec says the detection has no time predicate',
    );
  }
  if (/\$[A-Za-z_][A-Za-z0-9_]*/.test(sql.replace(/\$end/g, ''))) {
    errors.push('sql: references a parameter other than $end, which cannot be bound');
  }

  if (!Array.isArray(value.antiJoinKeys) || value.antiJoinKeys.length === 0) {
    warnings.push('antiJoinKeys: not declared');
  }

  return result({ ...value, sql }, errors, warnings);
}

// -----------------------------------------------------------------------------
// Running the chain
// -----------------------------------------------------------------------------

/**
 * Bind values for generated SQL, derived from the SQL text rather than from the
 * model's declaration about it. $end is the only parameter on offer, and a
 * query that does not mention it gets an empty bind — the same rule
 * baselineParams() applies from the declared `params` list, except that here
 * there is nothing to declare it but the query itself.
 */
export function paramsFor(sql, { analysisEnd = ANALYSIS_END_ISO } = {}) {
  return sql.includes('$end') ? { $end: analysisEnd } : {};
}

/**
 * Run all three stages for one template.
 *
 * Never throws. A transport failure and a validation failure both come back as
 * a stopped chain with everything completed so far attached, because the
 * partial result is most of the diagnosis: knowing that resolution succeeded
 * and extraction picked the wrong table is the finding.
 *
 * `onStage` is called with each stage record as it completes, for progressive
 * display.
 *
 * `call` replaces the transport. The default picks live or recorded from this
 * module's key; a caller with a key of its own — see callStageLive — supplies
 * one that always goes live. The orchestration below stays the one copy either
 * way, which is the point of the seam.
 */
export async function generateSql({
  template,
  recordings = null,
  onStage = null,
  call = callStage,
}) {
  const stages = [];

  const record = (entry) => {
    stages.push(entry);
    if (onStage) onStage(entry);
    return entry;
  };

  const stopped = (entry) => ({
    ok: false,
    stoppedAt: entry.stage,
    asopId: null,
    resolution: null,
    spec: null,
    sql: null,
    params: null,
    stages,
  });

  // Runs one stage and validates it. Returns the parsed value, or null if the
  // chain should stop.
  async function step(stage, userPrompt, validate) {
    let response;
    try {
      response = await call(stage, { templateId: template.id, userPrompt, recordings });
    } catch (error) {
      record({ stage, ok: false, call: null, prompt: userPrompt, errors: [error.message], warnings: [] });
      return null;
    }

    const parsed = validate(response.raw);
    record({
      stage,
      ok: parsed.ok,
      call: response,
      prompt: userPrompt,
      value: parsed.value,
      errors: parsed.errors,
      warnings: parsed.warnings,
    });
    return parsed.ok ? parsed.value : null;
  }

  // 1. Which ASOP is this? -------------------------------------------------
  const resolution = await step('resolve', buildResolvePrompt(template.text), parseResolved);
  if (!resolution) return stopped(stages[stages.length - 1]);

  // 2. What is the condition? ---------------------------------------------
  //
  // The document only. Stage 1's answer is not passed in: the two stages are
  // independent readings of the same text, so a wrong table and a wrong ASOP
  // stay separate findings instead of one explaining the other away.
  const spec = await step('extract', buildExtractPrompt(template.text), parseSpec);
  if (!spec) return stopped(stages[stages.length - 1]);

  // 3. Write it. The spec is the whole input; the document is not passed on.
  const composed = await step(
    'compose',
    buildComposePrompt({ asopId: resolution.asopId, spec }),
    (raw) => parseComposed(raw, { asopId: resolution.asopId, spec }),
  );
  if (!composed) return stopped(stages[stages.length - 1]);

  return {
    ok: true,
    stoppedAt: null,
    asopId: resolution.asopId,
    resolution,
    spec,
    sql: composed.sql,
    params: paramsFor(composed.sql),
    stages,
  };
}

/** Total tokens and wall time across a completed or stopped chain. */
export function chainUsage(stages) {
  return stages.reduce(
    (total, entry) => ({
      inputTokens: total.inputTokens + (entry.call?.usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (entry.call?.usage?.outputTokens ?? 0),
      elapsedMs: total.elapsedMs + (entry.call?.elapsedMs ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, elapsedMs: 0 },
  );
}
