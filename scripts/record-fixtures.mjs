// Capture real model responses for every template and write them to
// src/data/recordedResponses.js, which demo mode serves when no API key is
// present in the build.
//
//     VITE_ANTHROPIC_API_KEY=sk-ant-... npm run record
//
// Run this whenever a template changes: a recording is bound to the exact
// template text it answers, so an edited template invalidates its recording.
//
// This is a build-time script. It reads the key from the process environment
// and nothing it writes contains the key.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { templates } from '../src/data/templates.js';
import { hashText } from '../src/engine/hash.js';
// The prompt spec comes from the app itself, so a recording is always a
// recording of what the app actually sends. generate.js guards its
// import.meta.env access specifically so it can be imported here.
import {
  MODEL,
  SYSTEM_PROMPT,
  RUNBOOK_SCHEMA,
  buildUserPrompt,
} from '../src/engine/generate.js';

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/data/recordedResponses.js',
);

const apiKey = process.env.VITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    'No API key. Set VITE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) and run again.',
  );
  process.exit(1);
}

const client = new Anthropic({ apiKey });

const records = {};

for (const template of templates) {
  process.stderr.write(`Recording ${template.id} ... `);
  const startedAt = Date.now();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: RUNBOOK_SCHEMA },
    },
    messages: [{ role: 'user', content: buildUserPrompt(template.text) }],
  });

  if (response.stop_reason === 'refusal') {
    console.error(`refused (${response.stop_details?.category ?? 'no category'})`);
    process.exit(1);
  }
  if (response.stop_reason === 'max_tokens') {
    console.error('hit max_tokens before finishing — raise it and retry');
    process.exit(1);
  }

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Fail loudly here rather than shipping a fixture the app cannot parse.
  JSON.parse(raw);

  records[template.id] = {
    templateId: template.id,
    templateHash: hashText(template.text),
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    elapsedMs: Date.now() - startedAt,
    recordedAt: new Date().toISOString(),
    raw,
  };

  process.stderr.write(`ok (${Date.now() - startedAt}ms)\n`);
}

const header = `// Recorded model responses, served by demo mode when no API key is present.
//
// GENERATED FILE — captured from live API calls by scripts/record-fixtures.mjs.
// Re-run \`npm run record\` after changing a template or the prompt; a recording
// is bound by \`templateHash\` to the exact template text it answers, and demo
// mode refuses to serve one whose template has since been edited.

export const FIXTURES_ARE_SYNTHETIC = false;

export const recordedResponses = ${JSON.stringify(records, null, 2)};
`;

await writeFile(OUT, header, 'utf8');
console.error(`\nWrote ${Object.keys(records).length} recordings to ${OUT}`);
