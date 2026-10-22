// End-to-end check of the SQL generation layer, against the ground truth in
// src/db/baselines.js.
//
//   npm run gen:check -- --self-test        no API calls at all — see below
//   npm run gen:check -- --only ASOP-114    one template, live
//   npm run gen:check                       every template, live
//
//   --print-sql   dump the SQL that was scored
//   --stages      dump each stage's parsed output: what it resolved and why,
//                 the extracted spec, the compose notes
//
// Node only. No UI, no component, no fixture. It runs the same three-stage
// chain the Generate tab runs — src/engine/generate-sql.js, one copy — with a
// client built from the shell environment, then scores the result with
// src/engine/score.js against the hand-written baseline for that ASOP.
//
// RUN --self-test FIRST, AND BELIEVE NOTHING UNTIL IT PASSES
//
// The self-test feeds each baseline's own SQL back through the scorer as if it
// had been generated. It must come out perfect on all five dimensions, because
// it is being compared with itself. If it does not, the scorer is broken, and
// every live result after that is uninterpretable — a scoring bug and a
// generation bug produce the same red text. It costs nothing and takes a
// second, so there is no reason to spend a model call before it passes.
//
// THE KEY
//
// Read from the environment, never written anywhere. This script prints SQL,
// counts and model output; none of that contains it. Unlike the browser build
// there is no inlining problem here — see the key-handling note in
// src/engine/generate.js for why that constraint exists at all.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import initSqlJs from 'sql.js';
// Vite's .env loader, so this script reads the key from the same file the app
// does. Plain Node does not load .env on its own.
import { loadEnv } from 'vite';

import { buildDatabase } from '../src/db/build.js';
import { queryValue } from '../src/db/query.js';
import { BASELINES, BASELINES_BY_ID } from '../src/db/baselines.js';
import { sqlTemplates } from '../src/db/templates.js';
import { ANALYSIS_END } from '../src/db/seed/index.js';
import { MODEL, callStageLive, chainUsage, generateSql } from '../src/engine/generate-sql.js';
import { candidateFromBaseline, scoreCandidate } from '../src/engine/score.js';

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

let failures = 0;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const FLAGS = ['--self-test', '--print-sql', '--stages', '--only', '--save'];
const argv = process.argv.slice(2);

const unknown = argv.filter((arg) => arg.startsWith('--') && !FLAGS.includes(arg));
if (unknown.length > 0) {
  console.error(`\n${RED}Unknown flag(s): ${unknown.join(', ')}${RESET}`);
  console.error(`Available: ${FLAGS.join('  ')}\n`);
  process.exit(1);
}

const SELF_TEST = argv.includes('--self-test');
const PRINT_SQL = argv.includes('--print-sql');
const SHOW_STAGES = argv.includes('--stages');
// --save writes the live results to src/ai/results/generation.json for the site.
const SAVE = argv.includes('--save');

const onlyIndex = argv.indexOf('--only');
const ONLY = onlyIndex >= 0 ? argv[onlyIndex + 1] : null;
if (onlyIndex >= 0 && (!ONLY || ONLY.startsWith('--'))) {
  console.error(`\n${RED}--only needs a value, e.g. --only ASOP-114 or --only TPL-PORT-BLOCKED${RESET}\n`);
  process.exit(1);
}

/** --only matches either an ASOP id or a template id, case-insensitively. */
function selected(asopId, templateId = '') {
  if (!ONLY) return true;
  const needle = ONLY.toUpperCase();
  return asopId.toUpperCase() === needle || templateId.toUpperCase() === needle;
}

// ---------------------------------------------------------------------------
// The key. Named explicitly when it is missing, rather than falling back to
// something that would look like a run and prove nothing.
// ---------------------------------------------------------------------------

function resolveApiKey() {
  const fileEnv = loadEnv('development', ROOT, 'VITE_');
  return (
    process.env.ANTHROPIC_API_KEY ||
    process.env.VITE_ANTHROPIC_API_KEY ||
    fileEnv.VITE_ANTHROPIC_API_KEY ||
    ''
  );
}

// ---------------------------------------------------------------------------
// Reporting one score
// ---------------------------------------------------------------------------

function reportScore(score) {
  if (score.groundTruthError) {
    console.log(`  ${BAD}  ${pad('ground truth', 13)}${RED}${score.groundTruthError}${RESET}`);
    return;
  }

  const { resolution, execution, counts, rows, structure } = score;

  const resolved = resolution.checks.map((check) => (check.ok ? check.actual : `${check.actual}`));
  console.log(
    `  ${resolution.ok ? OK : BAD}  ${pad('resolution', 13)}${resolved.join(' · ')}`,
  );
  for (const check of resolution.checks) {
    if (!check.ok) {
      console.log(
        `        ${RED}${pad(check.label, 11)} expected ${check.expected}, got ${check.actual}${RESET}`,
      );
    }
  }

  console.log(
    `  ${execution.ok ? OK : BAD}  ${pad('execution', 13)}` +
      (execution.ok
        ? `${execution.rowCount} row(s) · ${execution.elapsedMs.toFixed(1)}ms · ${execution.columns.length} columns`
        : `${RED}${execution.error}${RESET}`),
  );

  console.log(
    `  ${counts.ok ? OK : BAD}  ${pad('counts', 13)}` +
      `${counts.actual ?? '-'} returned, baseline finds ${counts.expected}`,
  );

  if (!rows.comparable) {
    console.log(
      `  ${BAD}  ${pad('rows', 13)}${RED}` +
        (execution.ok
          ? `output carries no ${rows.missingColumns.join(', ')} — rows cannot be identified`
          : 'not run')
        + `${RESET}`,
    );
  } else {
    console.log(
      `  ${rows.ok ? OK : BAD}  ${pad('rows', 13)}` +
        `${rows.matched} matched · ${rows.extras.length} extra · ${rows.omissions.length} omitted` +
        `${DIM} on ${rows.identityColumns.join(' + ')}${RESET}`,
    );
    for (const identity of rows.extras) {
      console.log(`        ${RED}extra    ${identity}${RESET}`);
    }
    for (const identity of rows.omissions) {
      console.log(`        ${RED}omitted  ${identity}${RESET}`);
    }
    for (const identity of rows.duplicates) {
      console.log(`        ${RED}dup      ${identity}${RESET}`);
    }
    for (const row of rows.attributionDisagreements) {
      console.log(
        `        ${RED}bypass   ${row.identity} — baseline ${JSON.stringify(row.expected)}, got ${JSON.stringify(row.actual)}${RESET}`,
      );
    }
    if (!rows.attributionComparable) {
      console.log(`        ${RED}no bypass column to compare attribution on${RESET}`);
    }
  }

  const brokenRules = structure.checks.filter((check) => !check.ok);
  console.log(
    `  ${structure.ok ? OK : BAD}  ${pad('structure', 13)}` +
      `${structure.checks.length - brokenRules.length}/${structure.checks.length} house rules`,
  );
  for (const check of brokenRules) {
    console.log(`        ${RED}${check.name}${check.detail ? ` — ${check.detail}` : ''}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// --self-test: the scorer against the baselines it scores
// ---------------------------------------------------------------------------

function selfTest(db) {
  const chosen = BASELINES.filter((baseline) => selected(baseline.asopId));
  if (chosen.length === 0) {
    console.error(`\n${RED}--only ${ONLY} matched no baseline.${RESET}\n`);
    process.exit(1);
  }

  console.log(
    `${BOLD}Self-test${RESET} ${DIM}src/engine/score.js against the baselines it scores — no model calls${RESET}\n`,
  );
  console.log(
    `        ${pad('asop', 11)}${pad('shape', 25)}` +
      `${padStart('rows', 6)}${padStart('matched', 9)}${padStart('extra', 7)}` +
      `${padStart('omitted', 9)}${padStart('rules', 7)}`,
  );

  for (const baseline of chosen) {
    const candidate = candidateFromBaseline(baseline, { analysisEnd: END });
    const score = scoreCandidate({ db, baseline, candidate, analysisEnd: END });

    // Perfect is the only acceptable result, and a baseline that finds nothing
    // would score perfect vacuously — the same reason db:check rejects it.
    const finds = score.counts?.expected > 0;
    const ok = score.ok && finds;
    if (!ok) failures += 1;

    console.log(
      `  ${ok ? OK : BAD}  ${pad(baseline.asopId, 11)}${pad(baseline.shape, 25)}` +
        `${padStart(score.counts?.expected ?? '-', 6)}${padStart(score.rows?.matched ?? '-', 9)}` +
        `${padStart(score.rows?.extras.length ?? '-', 7)}${padStart(score.rows?.omissions.length ?? '-', 9)}` +
        `${padStart(score.structure ? `${score.structure.checks.length}` : '-', 7)}`,
    );

    if (!finds && score.counts) {
      console.log(`        ${RED}baseline returns no misses — scoring it proves nothing${RESET}`);
    }
    for (const failure of score.failures ?? []) {
      console.log(`        ${RED}${failure}${RESET}`);
    }
    if (PRINT_SQL) {
      console.log(`\n${DIM}${candidate.sql.trim()}${RESET}\n`);
    }
  }

  console.log(
    failures === 0
      ? `\n  ${DIM}Each baseline scores perfect against itself. A failure in a live run\n` +
          `  below is a generation failure, not a scoring one.${RESET}`
      : `\n  ${RED}${BOLD}The scorer is wrong. Do not spend a live call until this passes.${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Live: the three-stage chain, then the score
// ---------------------------------------------------------------------------

function stageDetail(entry) {
  const value = entry.value;
  // Nothing here when the stage failed: the errors print on their own lines
  // below, in full, rather than truncated into a column.
  if (!entry.ok || !value) return '';

  if (entry.stage === 'resolve') {
    return `${value.asopId} · ${value.confidence} confidence`;
  }
  if (entry.stage === 'extract') {
    const threshold =
      value.thresholdValue === null ? 'no threshold' : `${value.thresholdValue} ${value.thresholdUnit}`;
    return (
      `${value.table} · ${value.shape} · ${threshold} · ` +
      `${value.configs.length}c ${value.constrictions.length}r ${value.bypasses.length}b`
    );
  }
  return (
    `${value.sql.split('\n').length} lines · ` +
    `${value.usesAnalysisEnd ? 'binds $end' : 'no parameter'} · ` +
    `${value.antiJoinKeys.length} anti-join key(s)`
  );
}

function reportStages(stages) {
  for (const entry of stages) {
    const usage = entry.call?.usage;
    const cost = usage
      ? `${DIM}${padStart(secs(entry.call.elapsedMs), 7)}  ${thousands(usage.inputTokens)} in / ${thousands(usage.outputTokens)} out${RESET}`
      : '';
    console.log(
      `  ${entry.ok ? OK : BAD}  ${pad(entry.stage, 13)}${pad(stageDetail(entry), 62)}${cost}`,
    );
    for (const warning of entry.warnings ?? []) {
      console.log(`        ${DIM}warn  ${warning}${RESET}`);
    }
    for (const error of entry.ok ? [] : entry.errors ?? []) {
      console.log(`        ${RED}${error}${RESET}`);
    }
  }
}

function reportStageDetail(stages) {
  for (const entry of stages) {
    if (!entry.value) continue;
    console.log(`\n  ${DIM}── ${entry.stage} ─────────────────────────────────${RESET}`);
    if (entry.stage === 'resolve') {
      console.log(`  keyed on       ${entry.value.quoted_condition}`);
    } else if (entry.stage === 'extract') {
      console.log(
        JSON.stringify(entry.value, null, 2)
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      );
    } else {
      console.log(`  antiJoinKeys   ${entry.value.antiJoinKeys.join(', ')}`);
      if (entry.value.notes) console.log(`  notes          ${entry.value.notes}`);
    }
  }
  console.log('');
}

async function liveRun(db) {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error(
      `\n${RED}No API key.${RESET} This check makes live calls; there is no recorded path for it.\n\n` +
        `  Set ANTHROPIC_API_KEY or VITE_ANTHROPIC_API_KEY in the environment,\n` +
        `  or put VITE_ANTHROPIC_API_KEY in .env at the repo root (see .env.example).\n\n` +
        `  ${DIM}npm run gen:check -- --self-test${RESET} needs no key and proves the scorer.\n`,
    );
    process.exit(1);
  }

  const chosen = sqlTemplates.filter((template) => selected(template.asopId, template.id));
  if (chosen.length === 0) {
    console.error(`\n${RED}--only ${ONLY} matched no template.${RESET}`);
    console.error(
      `Covered: ${sqlTemplates.map((t) => `${t.asopId}/${t.id}`).join(', ')}\n`,
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  // The chain itself is generate-sql.js's, unchanged. Only the transport is
  // ours, because this module's key comes from import.meta.env and there is no
  // such thing under Node.
  const call = (stage, { userPrompt }) => callStageLive(stage, userPrompt, { client });

  console.log(
    `${BOLD}Generation${RESET} ${DIM}${MODEL} · ${chosen.length} template(s) · live${RESET}`,
  );

  const summary = [];
  const totals = { inputTokens: 0, outputTokens: 0, elapsedMs: 0, calls: 0 };

  for (const template of chosen) {
    const baseline = BASELINES_BY_ID[template.asopId];
    console.log(
      `\n${BOLD}${template.id}${RESET} ${DIM}→ expecting ${template.asopId} · ${baseline.name}${RESET}`,
    );

    const generated = await generateSql({ template, call });
    reportStages(generated.stages);
    if (SHOW_STAGES) reportStageDetail(generated.stages);

    const usage = chainUsage(generated.stages);
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.elapsedMs += usage.elapsedMs;
    // Calls actually made, not stages attempted — a chain that stopped at
    // resolve spent one, and the budget line should say so.
    totals.calls += generated.stages.filter((entry) => entry.call).length;

    if (!generated.ok) {
      failures += 1;
      console.log(
        `  ${BAD}  ${pad('chain', 13)}${RED}stopped at ${generated.stoppedAt}${RESET}`,
      );
      summary.push({
        template,
        ok: false,
        note: `stopped at ${generated.stoppedAt}`,
        score: null,
        stages: generated.stages.map((s) => ({ stage: s.stage, value: s.value ?? null })),
      });
      continue;
    }

    const score = scoreCandidate({
      db,
      baseline,
      candidate: generated,
      analysisEnd: END,
    });
    reportScore(score);

    if (PRINT_SQL) console.log(`\n${generated.sql.trim()}\n`);

    if (!score.ok) failures += 1;
    summary.push({
      template,
      ok: score.ok,
      note: score.ok ? 'perfect' : `${score.failures.length} finding(s)`,
      score,
      sql: generated.sql,
      stages: generated.stages.map((s) => ({ stage: s.stage, value: s.value ?? null })),
    });
  }

  // Summary ---------------------------------------------------------------
  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(
    `        ${pad('template', 20)}${pad('expected', 11)}${pad('resolved', 11)}` +
      `${padStart('rows', 6)}${padStart('base', 6)}  ${pad('verdict', 20)}`,
  );
  for (const entry of summary) {
    const score = entry.score;
    console.log(
      `  ${entry.ok ? OK : BAD}  ${pad(entry.template.id, 20)}${pad(entry.template.asopId, 11)}` +
        `${pad(score?.resolution.checks[0].actual ?? '-', 11)}` +
        `${padStart(score?.counts.actual ?? '-', 6)}${padStart(score?.counts.expected ?? '-', 6)}  ` +
        `${entry.ok ? entry.note : `${RED}${entry.note}${RESET}`}`,
    );
  }

  console.log(
    `\n  ${DIM}note${RESET}  ${pad('tokens', 20)}` +
      `${thousands(totals.inputTokens)} in / ${thousands(totals.outputTokens)} out ` +
      `${DIM}over ${totals.calls} call(s), ${secs(totals.elapsedMs)}${RESET}`,
  );

  if (SAVE && !ONLY) {
    const out = path.join(ROOT, 'src', 'ai', 'results', 'generation.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          model: MODEL,
          recordedAt: new Date().toISOString(),
          usage: totals,
          entries: summary.map((e) => ({
            templateId: e.template.id,
            label: e.template.label,
            expectedAsop: e.template.asopId,
            baselineName: BASELINES_BY_ID[e.template.asopId].name,
            ok: e.ok,
            note: e.note,
            sql: e.sql ?? null,
            stages: e.stages,
            score: e.score,
          })),
        },
        null,
        2,
      ),
    );
    console.log(`
  ${DIM}saved ${path.relative(ROOT, out)}${RESET}`);
  }
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

  // Set, not called. process.exit() here tears the loop down while the SDK's
  // keep-alive socket is still closing, which on Windows trips a libuv
  // assertion and aborts — replacing whatever exit code this script decided on
  // with the abort's. A check whose result is discarded by its own exit path is
  // worse than no check. Letting Node drain keeps the code we chose.
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`\n${RED}gen-check failed:${RESET}`, error);
  process.exitCode = 1;
});
