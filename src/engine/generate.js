// Generation layer: messy prose in, structured runbook definition out.
//
// This is the only part of the app that talks to a model. Everything
// downstream — validation, the detection engine, the audit view — operates on
// the parsed object and neither knows nor cares where it came from.
//
// Two paths, chosen by whether an API key is present at build time:
//
//   live   VITE_ANTHROPIC_API_KEY is set. Calls the Anthropic API directly
//          from the browser. Local development only.
//   demo   No key. Serves recorded responses for the unmodified presets.
//          This is what the deployed GitHub Pages build runs, because a
//          static public build must never carry a key.
//
// SECURITY: Vite inlines every VITE_-prefixed variable into the bundle as a
// string literal. A key present when `npm run build` runs is baked into the
// published JavaScript in plain text. Never build for deployment with the key
// set — the Pages workflow deliberately does not provide one.

import Anthropic from '@anthropic-ai/sdk';
// Explicit .js extensions: unlike the rest of the app, this module is also
// imported by scripts/record-fixtures.mjs under Node, which requires them.
import { recordedResponses, FIXTURES_ARE_SYNTHETIC } from '../data/recordedResponses.js';
import { hashText } from './hash.js';

export const MODEL = 'claude-opus-5';

// Optional chaining so this module also loads under plain Node, where
// `import.meta.env` does not exist — scripts/record-fixtures.mjs imports the
// prompt spec from here so there is only ever one copy of it.
const API_KEY = import.meta.env?.VITE_ANTHROPIC_API_KEY ?? '';

/** No key means no live generation. Recorded responses only. */
export const isDemoMode = !API_KEY;

export { FIXTURES_ARE_SYNTHETIC };

export const RESOURCE_TYPES = ['service', 'ticket', 'request'];

// -----------------------------------------------------------------------------
// Prompt
// -----------------------------------------------------------------------------

// The schema is the contract. Structured outputs constrain the response to it,
// so the raw output is already valid JSON of the right shape — parsing cannot
// fail on syntax. What it cannot constrain is whether the model read the
// document correctly, which is exactly what the audit downstream tests.
export const RUNBOOK_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Short human-readable name for the runbook.',
    },
    resourceType: {
      type: 'string',
      enum: RESOURCE_TYPES,
      description: 'The single resource type this runbook acts on.',
    },
    triggerState: {
      type: 'string',
      description:
        'The exact resource state string that opens the trigger condition, as it appears in the monitoring system.',
    },
    thresholdMinutes: {
      type: 'integer',
      description:
        'How many continuous minutes the resource must remain in triggerState before the action should fire. Current value only — ignore superseded ones.',
    },
    action: {
      type: 'string',
      description: 'The identifier of the action the automation performs.',
    },
    owner: {
      type: 'string',
      description: 'The team that owns this runbook.',
    },
    exclusionList: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Individual resource IDs exempted from this runbook. Expand any range written as a shorthand into every ID it covers. Empty array if none.',
    },
    excludedResourceTypes: {
      type: 'array',
      items: { type: 'string', enum: RESOURCE_TYPES },
      description:
        'Resource types explicitly placed out of scope. Empty array if none.',
    },
    notes: {
      type: 'string',
      description:
        'Anything ambiguous, contradictory, or superseded in the source document, and which reading was taken. Empty string if the document was unambiguous.',
    },
  },
  required: [
    'name',
    'resourceType',
    'triggerState',
    'thresholdMinutes',
    'action',
    'owner',
    'exclusionList',
    'excludedResourceTypes',
    'notes',
  ],
  additionalProperties: false,
};

export const SYSTEM_PROMPT = `You convert internal ITSM runbook documentation into the structured definition an automation platform can execute.

The documents are real internal process notes, not specifications. Expect mixed languages, superseded values left inline beside current ones, thresholds stated more than once in different places, exclusions buried in prose, and email or wiki formatting. Read the whole document before deciding any field.

Rules:
- Where a value has been revised, take the current one. Revision histories and "previously X" asides tell you which is which.
- triggerState is an exact state string from the monitoring system, reproduced verbatim. Do not normalise, translate, or tidy it. Nearby states the document mentions only to rule out are not the trigger.
- Convert every duration to whole minutes.
- Expand ranges into explicit IDs. A range written as an endpoint pair covers every ID between them inclusive.
- Record disagreements, ambiguity, and anything superseded in notes, along with the reading you took. If the document is unambiguous, leave notes empty.
- Report what the document says, not what a sensible runbook would say. If the document describes something odd, extract it as written.`;

export function buildUserPrompt(templateText) {
  return `Extract the runbook definition from the document below.

<document>
${templateText}
</document>`;
}

// -----------------------------------------------------------------------------
// Live generation
// -----------------------------------------------------------------------------

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: API_KEY,
      // Required for direct browser calls. Safe only because this path runs
      // exclusively in local development — see the security note above.
      dangerouslyAllowBrowser: true,
    });
  }
  return client;
}

/**
 * Call the model. Returns the raw response text alongside enough metadata to
 * show what produced it. Throws with a readable message on any failure.
 */
export async function generateLive(templateText) {
  const startedAt = Date.now();

  const response = await getClient().messages.create({
    model: MODEL,
    // Thinking is on by default on this model and shares the max_tokens
    // budget with the response, so this is sized well above the ~300 tokens
    // of JSON the schema actually produces.
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: RUNBOOK_SCHEMA },
    },
    messages: [{ role: 'user', content: buildUserPrompt(templateText) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `The model declined this request (${response.stop_details?.category ?? 'no category given'}).`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'The response hit the token limit before it finished. Raise max_tokens in src/engine/generate.js.',
    );
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!text) {
    throw new Error('The model returned no text content.');
  }

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
// Demo mode
// -----------------------------------------------------------------------------

/**
 * A recorded response exists only for a preset that has not been edited. An
 * edited template has no recording and cannot be generated without a key —
 * saying so is better than serving a response that does not correspond to the
 * text on screen.
 */
export function recordedFor(templateId, templateText) {
  const record = recordedResponses[templateId];
  if (!record) return null;
  // Also catches a template edited in source since the response was recorded.
  if (record.templateHash !== hashText(templateText)) return null;
  return {
    raw: record.raw,
    source: 'recorded',
    model: record.model,
    usage: record.usage,
    elapsedMs: record.elapsedMs,
    recordedAt: record.recordedAt,
  };
}

/** Single entry point. Picks the path and reports plainly when it cannot run. */
export async function generate({ templateId, templateText }) {
  if (!isDemoMode) return generateLive(templateText);

  const recorded = recordedFor(templateId, templateText);
  if (recorded) return recorded;

  throw new Error(
    'Demo mode serves recorded responses for the two presets as written. This template has been edited, so there is no recording for it. Live generation needs VITE_ANTHROPIC_API_KEY — see the README.',
  );
}

// -----------------------------------------------------------------------------
// Parsing and validation
// -----------------------------------------------------------------------------

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Parse and validate independently of the schema that produced the output.
 * Structured outputs make this near-redundant on the happy path, which is the
 * point: the check belongs to this app, not to the generation call, and it
 * still runs if the schema, the model, or the transport ever changes.
 */
export function parseGenerated(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { ok: false, value: null, errors: [`Response is not valid JSON: ${error.message}`] };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, value: null, errors: ['Response is not a JSON object.'] };
  }

  const errors = [];
  const req = (field, ok, message) => {
    if (!ok) errors.push(`${field}: ${message}`);
  };

  req('name', typeof value.name === 'string' && value.name.trim(), 'missing or empty');
  req(
    'resourceType',
    RESOURCE_TYPES.includes(value.resourceType),
    `must be one of ${RESOURCE_TYPES.join(', ')} (got ${JSON.stringify(value.resourceType)})`,
  );
  req(
    'triggerState',
    typeof value.triggerState === 'string' && value.triggerState.trim(),
    'missing or empty',
  );
  req(
    'thresholdMinutes',
    Number.isInteger(value.thresholdMinutes) && value.thresholdMinutes >= 0,
    `must be a non-negative whole number of minutes (got ${JSON.stringify(value.thresholdMinutes)})`,
  );
  req('action', typeof value.action === 'string' && value.action.trim(), 'missing or empty');
  req('exclusionList', isStringArray(value.exclusionList), 'must be an array of resource IDs');
  req(
    'excludedResourceTypes',
    isStringArray(value.excludedResourceTypes) &&
      value.excludedResourceTypes.every((t) => RESOURCE_TYPES.includes(t)),
    `must be an array drawn from ${RESOURCE_TYPES.join(', ')}`,
  );

  return { ok: errors.length === 0, value, errors };
}

/**
 * Shape a validated definition into what `detect()` consumes.
 *
 * The generated definition takes the ID of the runbook whose documentation it
 * was extracted from. The anti-join matches on `runbookId + resourceId`, so a
 * fresh ID would find no executions at all and report every qualifying
 * interval as a miss. Reusing the configured ID puts the generated definition
 * up against the same execution history as the real one, which is the only
 * comparison that says anything.
 */
export function toRunbook(parsed, { id, description }) {
  return {
    id,
    name: parsed.name,
    description: description ?? 'Generated from runbook documentation.',
    resourceType: parsed.resourceType,
    triggerState: parsed.triggerState,
    thresholdMinutes: parsed.thresholdMinutes,
    action: parsed.action,
    exclusionList: [...parsed.exclusionList],
    excludedResourceTypes: [...parsed.excludedResourceTypes],
    owner: parsed.owner || 'Unattributed',
    generated: true,
  };
}

/** Field-by-field comparison against the runbook as actually configured. */
export function diffAgainstConfigured(generated, configured) {
  const sameSet = (a, b) =>
    a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

  const fields = [
    ['resourceType', 'Resource type'],
    ['triggerState', 'Trigger state'],
    ['thresholdMinutes', 'Threshold (min)'],
    ['action', 'Action'],
    ['exclusionList', 'Exclusion list'],
    ['excludedResourceTypes', 'Excluded types'],
    ['owner', 'Owner'],
  ];

  return fields.map(([key, label]) => {
    const a = generated[key];
    const b = configured[key];
    const match = Array.isArray(a) ? sameSet(a, b) : a === b;
    return { key, label, generated: a, configured: b, match };
  });
}
