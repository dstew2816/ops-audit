// End-to-end check of the diagnosis layer, against the ground truth in
// src/db/expected-findings.js.
//
//   npm run diag:check -- --self-test    no API calls at all — see below
//   npm run diag:check                   live, one call
//
//   --print-findings   dump every finding, with its misses and its evidence
//   --print-prompt     dump the evidence bundle exactly as the model sees it
//
// Node only. No UI, no component, no fixture. It builds the database, runs all
// seven baselines to collect the misses, assembles the same evidence bundle
// src/engine/diagnose.js would assemble in the browser, makes the call with a
// client built from the shell environment, and scores the result with
// src/engine/diagnose-score.js.
//
// RUN --self-test FIRST, AND BELIEVE NOTHING UNTIL IT PASSES
//
// It has three parts and they get progressively less obvious.
//
//   1. The ground truth resolves. Every missId in expected-findings.js names a
//      miss the baselines actually return, all 24 are accounted for, and the
//      scoring key's own sets do not overlap. This is what fails when a seed
//      edit moves a miss out from under the answer.
//
//   2. The expected findings score perfect. Compared with themselves, so
//      anything less is a bug in the scorer.
//
//   3. THE SCORER REJECTS WRONG ANSWERS. Six deliberately broken diagnoses go
//      through it, each declaring which dimensions must go red, and the actual
//      set has to match exactly. Part 2 alone does not establish anything: a
//      scorer that returns ok for every input passes it. The one that matters
//      is `over-merged` — the answer a GROUP BY on time produces, twelve
//      in-window misses as one finding and the three coincidental ones as
//      another. A scorer that cannot reject that cannot tell the difference
//      between a diagnosis and a sort.
//
// THE KEY
//
// Read from the environment, never written anywhere. This script prints
// findings, counts and model output; none of that contains it.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import initSqlJs from 'sql.js';
import { loadEnv } from 'vite';

import { buildDatabase } from '../src/db/build.js';
import { queryValue } from '../src/db/query.js';
import { EXPECTED_FINDINGS, EXPECTED_MISS_COUNT, SCORING_KEY } from '../src/db/expected-findings.js';
import { ANALYSIS_END } from '../src/db/seed/index.js';
import {
  MODEL,
  buildEvidenceBundle,
  callDiagnoseLive,
  diagnose,
  parseDiagnosis,
} from '../src/engine/diagnose.js';
import { MUTATIONS, diagnosisFromExpected, scoreDiagnosis } from '../src/engine/diagnose-score.js';

const require = createRequire(import.meta.url);
const SQL_JS_DIR = path.dirname(require.resolve('sql.js'));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const END = new Date(ANALYSIS_END).toISOString().replace('.000Z', 'Z');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const OK = `${GREEN}ok${RESET}  `;
const BAD = `${RED}FAIL${RESET}`;

const pad = (value, width) => String(value).padEnd(width);
const padStart = (value, width) => String(value).padStart(width);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const thousands = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const DIMENSIONS = ['coverage', 'outage', 'trap', 'coincidental', 'standAlone'];

let failures = 0;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const FLAGS = ['--self-test', '--print-findings', '--print-prompt', '--save'];
const argv = process.argv.slice(2);

const unknown = argv.filter((arg) => arg.startsWith('--') && !FLAGS.includes(arg));
if (unknown.length > 0) {
  console.error(`\n${RED}Unknown flag(s): ${unknown.join(', ')}${RESET}`);
  console.error(`Available: ${FLAGS.join('  ')}\n`);
  process.exitCode = 1;
}

const SELF_TEST = argv.includes('--self-test');
const PRINT_FINDINGS = argv.includes('--print-findings');
const PRINT_PROMPT = argv.includes('--print-prompt');
// --save writes the live result to src/ai/results/diagnosis.json for the site.
const SAVE = argv.includes('--save');

function resolveApiKey() {
  const fileEnv = loadEnv('development', ROOT, 'VITE_');
  return (
    process.env.ANTHROPIC_API_KEY ||
    process.env.VITE_ANTHROPIC_API_KEY ||
    fileEnv.VITE_ANTHROPIC_API_KEY ||
    ''
  );
}

function assert(label, actual, expected, detail = '') {
  const ok = String(actual) === String(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? OK : BAD}  ${pad(label, 46)}${padStart(actual, 6)}` +
      (ok ? (detail ? ` ${DIM}${detail}${RESET}` : '') : `${RED}  expected ${expected}${RESET}`),
  );
}

// ---------------------------------------------------------------------------
// Reporting one score
// ---------------------------------------------------------------------------

/** The dimensions that came out red, in declaration order. */
function redDimensions(score) {
  return DIMENSIONS.filter((name) => score.dimensions[name] && !score.dimensions[name].ok);
}

function dimensionSummary(score) {
  return DIMENSIONS.map((name) => {
    const dimension = score.dimensions[name];
    const mark = dimension?.ok ? `${GREEN}${name}${RESET}` : `${RED}${name}${RESET}`;
    return mark;
  }).join(' ');
}

function reportScore(score) {
  console.log(`  ${score.ok ? OK : BAD}  ${dimensionSummary(score)}`);

  const outage = score.dimensions.outage;
  if (outage) {
    const detail =
      outage.findingsSpanned === 1
        ? `${outage.finding.size} miss(es), classed ${outage.causeClass}`
        : `split across ${outage.findingsSpanned} finding(s)`;
    console.log(`        ${DIM}outage cluster  ${detail}, expected ${outage.expected}${RESET}`);
  }

  const coincidental = score.dimensions.coincidental;
  if (coincidental) {
    console.log(
      `        ${DIM}coincidental    ${coincidental.distinctFindings} finding(s) for ` +
        `${coincidental.expectedFindings} unrelated causes${RESET}`,
    );
  }

  for (const failure of score.failures) {
    console.log(`        ${RED}${failure}${RESET}`);
  }
}

function printFindings(findings) {
  console.log('');
  for (const finding of findings) {
    console.log(
      `  ${BOLD}${finding.title}${RESET} ${DIM}· ${finding.causeClass}` +
        `${finding.confidence ? ` · ${finding.confidence} confidence` : ''}${RESET}`,
    );
    console.log(`    ${DIM}${finding.missIds.join('\n    ')}${RESET}`);
    console.log(`    ${finding.cause}`);
    for (const item of finding.evidence ?? []) console.log(`      ${DIM}— ${item}${RESET}`);
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

function selfTest(db) {
  const bundle = buildEvidenceBundle(db, { analysisEnd: END });

  // 1. The ground truth still describes this data --------------------------
  console.log(
    `${BOLD}Ground truth${RESET} ${DIM}src/db/expected-findings.js against the misses the baselines return${RESET}`,
  );

  assert('misses collected', bundle.misses.length, 24);
  assert('expected findings account for', EXPECTED_MISS_COUNT, bundle.misses.length);

  const known = new Set(bundle.missIds);
  const dangling = EXPECTED_FINDINGS.flatMap((finding) =>
    finding.missIds.filter((id) => !known.has(id)),
  );
  assert('every expected missId resolves', dangling.length, 0, `${known.size} in the bundle`);
  for (const id of dangling) {
    console.log(`        ${RED}${id} names no miss — the seed data moved under the answer${RESET}`);
  }

  // Miss ids have to be unique or the whole scheme silently mis-joins.
  assert('missIds unique', new Set(bundle.missIds).size, bundle.misses.length);

  // The key's own sets must not overlap: a miss cannot both be part of the one
  // common cause and be one of the misses that cause does not explain.
  const keyed = [
    ...SCORING_KEY.outage.missIds,
    ...SCORING_KEY.coincidental.map((entry) => entry.missId),
    ...SCORING_KEY.notExplainedByOutage,
    ...SCORING_KEY.standAlone,
  ];
  assert('scoring key sets disjoint', keyed.length - new Set(keyed).size, 0);
  assert(
    'scoring key resolves',
    keyed.filter((id) => !known.has(id)).length,
    0,
    `${keyed.length} of ${bundle.misses.length} misses are scored`,
  );

  // The premise of the trap: the four are inside the outage window, and their
  // detections are the ones with no time dimension. If a change ever makes that
  // false the trap has stopped being a trap, and it should say so here rather
  // than keep passing.
  const outageWindow = bundle.platformStatus.find((w) => w.window_id === SCORING_KEY.outage.windowId);
  const timeless = new Set(
    bundle.detections.filter((d) => !d.joinsPlatformStatus).map((d) => d.asopId),
  );
  const trapAsops = [...new Set(SCORING_KEY.notExplainedByOutage.map((id) => id.split(':')[0]))];
  assert('outage window found', outageWindow ? outageWindow.status : 'missing', 'down');
  assert(
    'in-window misses are on timeless detections',
    trapAsops.filter((asopId) => !timeless.has(asopId)).length,
    0,
    `${trapAsops.join(', ')} consult no platform status`,
  );

  // 2. The expected findings score perfect ---------------------------------
  console.log(
    `\n${BOLD}Scorer against the truth${RESET} ${DIM}the expected findings, compared with themselves${RESET}`,
  );

  const expected = diagnosisFromExpected();
  const score = scoreDiagnosis({ findings: expected, knownMissIds: bundle.missIds });
  if (!score.ok) failures += 1;
  reportScore(score);
  if (PRINT_FINDINGS) printFindings(expected);

  // 3. The scorer rejects wrong answers ------------------------------------
  console.log(
    `\n${BOLD}Scorer against wrong answers${RESET} ${DIM}each must fail exactly the dimensions it declares${RESET}`,
  );
  console.log(
    `        ${pad('mutation', 26)}${pad('must fail', 34)}${pad('did fail', 34)}`,
  );

  for (const mutation of MUTATIONS) {
    let red;
    let error = null;
    try {
      const broken = mutation.build(diagnosisFromExpected());
      red = redDimensions(scoreDiagnosis({ findings: broken, knownMissIds: bundle.missIds }));
    } catch (problem) {
      red = [];
      error = problem.message;
    }

    const same =
      error === null &&
      red.length === mutation.mustFail.length &&
      mutation.mustFail.every((name) => red.includes(name));
    if (!same) failures += 1;

    console.log(
      `  ${same ? OK : BAD}  ${pad(mutation.name, 26)}${pad(mutation.mustFail.join(' '), 34)}` +
        `${same ? DIM : RED}${pad(red.join(' ') || 'nothing', 34)}${RESET}`,
    );
    console.log(`        ${DIM}${mutation.what} — ${mutation.why}${RESET}`);
    if (error) console.log(`        ${RED}mutation threw: ${error}${RESET}`);
  }

  // 4. The validator rejects malformed answers -----------------------------
  //
  // parseDiagnosis() runs before anything reaches the scorer, and it enforces
  // the partition rules the scorer then checks again. Exercised here because
  // otherwise the only thing that ever tests it is a live call, and a validator
  // that wrongly accepts is indistinguishable from one that is never reached.
  console.log(
    `\n${BOLD}Validator${RESET} ${DIM}src/engine/diagnose.js parseDiagnosis, before anything is scored${RESET}`,
  );

  const asRaw = (findings, notes = '') => JSON.stringify({ findings, notes });
  const first = (findings) => findings[0].missIds[0];

  const cases = [
    {
      name: 'the expected findings',
      accept: true,
      raw: () => asRaw(diagnosisFromExpected()),
    },
    {
      name: 'a missId not in the bundle',
      accept: false,
      raw: () => {
        const findings = diagnosisFromExpected();
        findings[0] = { ...findings[0], missIds: [...findings[0].missIds, 'ASOP-999:NOPE'] };
        return asRaw(findings);
      },
    },
    {
      name: 'the same miss in two findings',
      accept: false,
      raw: () => {
        const findings = diagnosisFromExpected();
        findings[1] = { ...findings[1], missIds: [...findings[1].missIds, first(findings)] };
        return asRaw(findings);
      },
    },
    {
      name: 'a miss left out entirely',
      accept: false,
      raw: () => {
        const findings = diagnosisFromExpected();
        findings[0] = { ...findings[0], missIds: findings[0].missIds.slice(1) };
        return asRaw(findings);
      },
    },
    {
      name: 'a causeClass outside the vocabulary',
      accept: false,
      raw: () => {
        const findings = diagnosisFromExpected();
        findings[0] = { ...findings[0], causeClass: 'gremlins' };
        return asRaw(findings);
      },
    },
    {
      name: 'a finding with no evidence',
      accept: false,
      raw: () => {
        const findings = diagnosisFromExpected();
        findings[0] = { ...findings[0], evidence: [] };
        return asRaw(findings);
      },
    },
    { name: 'not JSON at all', accept: false, raw: () => 'I had a think about it and' },
  ];

  for (const testCase of cases) {
    const parsed = parseDiagnosis(testCase.raw(), { knownMissIds: bundle.missIds });
    const ok = parsed.ok === testCase.accept;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? OK : BAD}  ${pad(testCase.name, 36)}` +
        `${DIM}${testCase.accept ? 'accepted' : 'rejected'}${RESET}` +
        (parsed.ok ? '' : ` ${DIM}— ${parsed.errors[0]}${RESET}`),
    );
  }

  console.log(
    failures === 0
      ? `\n  ${DIM}The truth scores perfect, every wrong answer is rejected for the right\n` +
          `  reason, and malformed output does not reach the scorer. A failure in a\n` +
          `  live run below is a diagnosis failure.${RESET}`
      : `\n  ${RED}${BOLD}The scorer is wrong. Do not spend a live call until this passes.${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

async function liveRun(db) {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error(
      `\n${RED}No API key.${RESET} This check makes a live call; there is no recorded path for it.\n\n` +
        `  Set ANTHROPIC_API_KEY or VITE_ANTHROPIC_API_KEY in the environment,\n` +
        `  or put VITE_ANTHROPIC_API_KEY in .env at the repo root (see .env.example).\n\n` +
        `  ${DIM}npm run diag:check -- --self-test${RESET} needs no key and proves the scorer.\n`,
    );
    failures += 1;
    return;
  }

  const bundle = buildEvidenceBundle(db, { analysisEnd: END });

  console.log(
    `${BOLD}Diagnosis${RESET} ${DIM}${MODEL} · ${bundle.misses.length} misses across ` +
      `${bundle.detections.length} automations · live${RESET}\n`,
  );

  const client = new Anthropic({ apiKey });
  // The chain is diagnose.js's, unchanged. Only the transport is ours, because
  // that module's key comes from import.meta.env and there is none under Node.
  const call = (prompt) => callDiagnoseLive(prompt, { client });

  const result = await diagnose({ bundle, call });

  if (PRINT_PROMPT) console.log(`${DIM}${result.prompt}${RESET}\n`);

  const usage = result.call?.usage;
  if (usage) {
    console.log(
      `  ${DIM}note  ${pad('tokens', 26)}${thousands(usage.inputTokens)} in / ` +
        `${thousands(usage.outputTokens)} out, ${secs(result.call.elapsedMs)}${RESET}`,
    );
  }

  if (!result.ok) {
    failures += 1;
    console.log(`  ${BAD}  diagnosis rejected before scoring`);
    for (const error of result.errors) console.log(`        ${RED}${error}${RESET}`);
    return;
  }

  for (const warning of result.warnings) console.log(`        ${DIM}warn  ${warning}${RESET}`);

  console.log(
    `  ${DIM}note  ${pad('findings', 26)}${result.findings.length} over ${bundle.misses.length} misses${RESET}\n`,
  );

  const score = scoreDiagnosis({ findings: result.findings, knownMissIds: bundle.missIds });
  if (!score.ok) failures += 1;
  reportScore(score);

  if (PRINT_FINDINGS) printFindings(result.findings);

  if (SAVE) {
    const out = path.join(ROOT, 'src', 'ai', 'results', 'diagnosis.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          model: MODEL,
          recordedAt: new Date().toISOString(),
          usage: result.call?.usage ?? null,
          elapsedMs: result.call?.elapsedMs ?? null,
          misses: bundle.misses.length,
          findings: result.findings,
          notes: result.notes ?? null,
          score,
        },
        null,
        2,
      ),
    );
    console.log(`
  ${DIM}saved ${path.relative(ROOT, out)}${RESET}`);
  }
  if (result.notes) console.log(`\n  ${DIM}notes  ${result.notes}${RESET}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(SQL_JS_DIR, file) });
  const db = buildDatabase(SQL);

  console.log(`\n${DIM}SQLite ${queryValue(db, 'SELECT sqlite_version()')} via sql.js${RESET}\n`);

  if (SELF_TEST) selfTest(db);
  else await liveRun(db);

  db.close();

  console.log(
    failures === 0
      ? `\n${GREEN}All checks passed.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  );

  // Set, not called. Same reason as gen-check.mjs: process.exit() here tears
  // the loop down while the SDK's keep-alive socket is still closing, which on
  // Windows trips a libuv assertion that aborts the process and replaces this
  // verdict with its own exit code.
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`
${RED}Unexpected error: ${error?.message ?? error}${RESET}
`);
  process.exitCode = 1;
});
