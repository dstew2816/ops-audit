// Diagnostic for the live model calls. Makes a handful of small calls that differ
// in ONE way each and prints how the API answered, so a refusal or an error can
// be traced to its cause instead of guessed at. Not part of the audit; it scores
// nothing and saves nothing.
//
//   $env:ANTHROPIC_API_KEY = "..."
//   node scripts/ai-probe.mjs
//
// The key is read from the environment and never printed.

import Anthropic from '@anthropic-ai/sdk';

import { sqlTemplates } from '../src/db/templates.js';
import {
  MODEL,
  RESOLVE_SCHEMA,
  RESOLVE_SYSTEM_PROMPT,
  buildResolvePrompt,
} from '../src/engine/generate-sql.js';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY first.');
  process.exit(1);
}
const client = new Anthropic({ apiKey });
const prompt = buildResolvePrompt(sqlTemplates[0].text);

// An evidence-style schema: facts about the document, no request to explain
// the model's own reasoning.
const EVIDENCE_SCHEMA = {
  type: 'object',
  properties: {
    asopId: RESOLVE_SCHEMA.properties.asopId,
    confidence: RESOLVE_SCHEMA.properties.confidence,
    quoted_condition: { type: 'string', description: 'A short quote from the document stating the condition and threshold.' },
  },
  required: ['asopId', 'confidence', 'quoted_condition'],
  additionalProperties: false,
};

const BASE = { max_tokens: 6000, system: RESOLVE_SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] };
const withSchema = (schema) => ({ effort: 'high', format: { type: 'json_schema', schema } });

const VARIANTS = [
  { name: 'V1 current call', params: { model: MODEL, ...BASE, output_config: withSchema(RESOLVE_SCHEMA) } },
  { name: 'V2 no effort setting', params: { model: MODEL, ...BASE, output_config: { format: { type: 'json_schema', schema: RESOLVE_SCHEMA } } } },
  {
    name: 'V3 evidence schema, plain system prompt',
    params: {
      model: MODEL,
      ...BASE,
      system: 'You identify which registered automation a piece of internal process documentation describes. Resolve on what the document is about: the condition it describes, what it is observed on, and its threshold.',
      output_config: withSchema(EVIDENCE_SCHEMA),
    },
  },
  { name: 'V4 current call, claude-opus-5-5', params: { model: 'claude-opus-5-5', ...BASE, output_config: withSchema(RESOLVE_SCHEMA) } },
  { name: 'V5 current call, claude-sonnet-5-5', params: { model: 'claude-sonnet-5-5', ...BASE, output_config: withSchema(RESOLVE_SCHEMA) } },
  {
    name: 'V6 evidence schema, claude-sonnet-5-5',
    params: {
      model: 'claude-sonnet-5-5',
      ...BASE,
      system: 'You identify which registered automation a piece of internal process documentation describes. Resolve on what the document is about: the condition it describes, what it is observed on, and its threshold.',
      output_config: withSchema(EVIDENCE_SCHEMA),
    },
  },
];

for (const variant of VARIANTS) {
  try {
    const response = await client.messages.create(variant.params);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    console.log(
      `${variant.name.padEnd(42)} stop=${response.stop_reason}` +
        `${response.stop_details?.category ? ` category=${response.stop_details.category}` : ''}` +
        ` out=${response.usage.output_tokens} :: ${text.slice(0, 90).replace(/\s+/g, ' ')}`,
    );
  } catch (error) {
    console.log(`${variant.name.padEnd(42)} ERROR ${error.status ?? ''} ${String(error.message).slice(0, 140)}`);
  }
}
process.exitCode = 0;
