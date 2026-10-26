// Results of the Python pipeline in /ml, side by side with the hand-written
// branching rules, scored on the same held-out set. The page only displays
// ml/results/results.json; re-run `python ml/train.py` to regenerate it.

import { useState } from 'react';
import results from '../../ml/results/results.json';

const MODELS = [
  { id: 'rules_en', label: 'Hand rules (English)', note: 'Branching keyword rules, English words only' },
  { id: 'rules_multi', label: 'Hand rules (multilingual)', note: 'Same rules, multilingual keywords' },
  { id: 'decision_tree', label: 'Decision tree', note: 'Learned from the training set' },
  { id: 'random_forest', label: 'Random forest', note: '300 trees, for comparison' },
  { id: 'majority_class', label: 'Always guess the most common class', note: 'The floor' },
];

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const pretty = (s) => s.replaceAll('_', ' ');
const leafLabel = Object.fromEntries(results.leaves.map((l) => [l.id, l.label]));
const leavesByKind = Object.fromEntries(results.kinds.map((k) => [k, results.leaves.filter((l) => l.kind === k)]));

const KIND_BLURB = {
  interval: 'Elapsed time against a limit',
  state: 'A flag or mode left in the wrong position',
  missing: 'A required field is blank',
  absent: 'Something due never happened',
  count: 'Retries or repeats past a ceiling',
  countdown: 'Time remaining before a deadline',
};

function Bar({ value, ci, tone }) {
  return (
    <div className="relative h-2 w-32 rounded bg-slate-800">
      <div className={`absolute inset-y-0 left-0 rounded ${tone}`} style={{ width: `${value * 100}%` }} />
      {ci && (
        <div
          className="absolute top-[-2px] h-3 border-x border-slate-300/70"
          style={{ left: `${ci[0] * 100}%`, width: `${(ci[1] - ci[0]) * 100}%` }}
          title={`95% interval ${pct(ci[0])} to ${pct(ci[1])}`}
        />
      )}
    </div>
  );
}

function KindConfusion({ matrix }) {
  const max = Math.max(...matrix.flat());
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px]">
        <thead>
          <tr>
            <th className="px-2 py-1 text-right font-normal text-slate-600">true ↓ / predicted →</th>
            {results.kinds.map((k) => (
              <th key={k} className="px-2 py-1 text-center font-normal text-slate-500">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="px-2 py-1 text-right text-slate-500">{results.kinds[i]}</td>
              {row.map((v, j) => (
                <td
                  key={j}
                  className="h-8 w-16 text-center font-mono"
                  style={{
                    backgroundColor: v === 0 ? 'transparent' : i === j ? `rgba(52,211,153,${0.12 + 0.5 * (v / max)})` : `rgba(251,113,133,${0.2 + 0.6 * (v / max)})`,
                    color: v === 0 ? '#475569' : '#e2e8f0',
                  }}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeafConfusion({ matrix }) {
  const max = Math.max(...matrix.flat().filter((v, i) => v > 0 && Math.floor(i / matrix.length) !== i % matrix.length), 1);
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0 text-[10px]">
        <thead>
          <tr>
            <th className="pr-2 text-right font-normal text-slate-600">true ↓ / predicted →</th>
            {results.leaves.map((l, j) => (
              <th key={l.id} title={l.label} className="w-[15px] min-w-[15px] pb-1 text-center font-normal text-slate-600">
                {j + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-right whitespace-nowrap text-slate-500">
                <span className="mr-1 text-slate-700">{i + 1}</span>
                {results.leaves[i].label}
              </td>
              {row.map((v, j) => (
                <td
                  key={j}
                  title={`${results.leaves[i].label} → ${results.leaves[j].label}: ${v}`}
                  className="h-[15px] w-[15px] min-w-[15px] border border-slate-900/60 text-center font-mono"
                  style={{
                    backgroundColor:
                      v === 0 ? 'transparent' : i === j ? `rgba(52,211,153,${0.15 + 0.5 * Math.min(v / 12, 1)})` : `rgba(251,113,133,${0.3 + 0.6 * (v / max)})`,
                    color: '#e2e8f0',
                    fontSize: 9,
                  }}
                >
                  {v === 0 ? '' : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MlTab() {
  const [selected, setSelected] = useState('decision_tree');
  const m = results.test_metrics;
  const cv = results.cross_validation;
  const sel = m[selected];
  const d = results.dataset;
  const dis = results.disagreements;

  return (
    <div className="space-y-12">
      <p className="max-w-3xl text-[15px] leading-[1.75] text-slate-400">
        The task is to read a messy procedure definition and work out two things: the <span className="text-slate-300">kind</span> of
        check it is ({results.kinds.length} kinds), and the <span className="text-slate-300">specific thing</span> it watches
        ({d.n_leaves} of them, such as queue time, time since preventive maintenance (PM), or a hold with no owner). A decision tree
        learns this from labeled examples, and branching keyword rules written by hand try the same task. Both are scored once on
        the same {d.n_test} held-out records.
      </p>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Records', d.n, `${d.n_train} train / ${d.n_test} test · ${d.n_leaves} specifics`],
          ['Tree: specific thing', pct(m.decision_tree.leaf_accuracy), `hand rules: ${pct(m.rules_en.leaf_accuracy)} (English), ${pct(m.rules_multi.leaf_accuracy)} (multilingual)`],
          ['Tree: kind of check', pct(m.decision_tree.kind_accuracy), `hand rules: ${pct(m.rules_en.kind_accuracy)} (English)`],
          ['Cross-validation', pct(cv.decision_tree.cv_leaf_accuracy_mean), `tree, ± ${pct(cv.decision_tree.cv_leaf_accuracy_std)} over 5 folds, train only`],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3">
            <div className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</div>
            <div className="mt-1 font-mono text-[20px] text-slate-100">{value}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{note}</div>
          </div>
        ))}
      </section>

      {/* Taxonomy ---------------------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">What it is classifying</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {results.kinds.map((k) => (
            <div key={k} className="rounded border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[12px] text-sky-300">{k}</span>
                <span className="text-[11px] text-slate-600">{leavesByKind[k].length} specifics</span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">{KIND_BLURB[k]}</div>
              <ul className="mt-2 space-y-0.5 text-[12px] text-slate-400">
                {leavesByKind[k].map((l) => (
                  <li key={l.id}>{l.label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Side by side ---------------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Side by side on the held-out set</h2>
        <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
          Each bar shows test accuracy, and the pale bracket marks the 95% interval. Click a row for its detail below.
        </p>
        <div className="mt-3 overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Method</th>
                <th className="px-3 py-2 text-left font-medium">Kind of check</th>
                <th className="px-3 py-2 text-left font-medium">Specific thing</th>
                <th className="px-3 py-2 text-right font-medium">95% interval</th>
                <th className="px-3 py-2 text-right font-medium">Macro F1</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {MODELS.map((model) => {
                const r = m[model.id];
                const learned = model.id === 'decision_tree' || model.id === 'random_forest';
                const tone = learned ? 'bg-sky-400/80' : 'bg-slate-500';
                return (
                  <tr
                    key={model.id}
                    onClick={() => setSelected(model.id)}
                    className={`cursor-pointer ${selected === model.id ? 'bg-slate-800/60' : 'hover:bg-slate-900/60'}`}
                  >
                    <td className="px-3 py-2">
                      <div className="text-slate-200">{model.label}</div>
                      <div className="text-[11px] text-slate-600">{model.note}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <Bar value={r.kind_accuracy} ci={r.kind_accuracy_ci95} tone={tone} />
                        <span className="font-mono tabular-nums text-slate-300">{pct(r.kind_accuracy)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <Bar value={r.leaf_accuracy} ci={r.leaf_accuracy_ci95} tone={tone} />
                        <span className="font-mono tabular-nums text-slate-200">{pct(r.leaf_accuracy)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-500">
                      {pct(r.leaf_accuracy_ci95[0])}–{pct(r.leaf_accuracy_ci95[1])}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{r.leaf_macro_f1.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Detail ------------------------------------------------------------------ */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">
          Detail: {MODELS.find((x) => x.id === selected).label}
        </h2>
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Kind</th>
                  <th className="px-3 py-2 text-right font-medium">Precision</th>
                  <th className="px-3 py-2 text-right font-medium">Recall</th>
                  <th className="px-3 py-2 text-right font-medium">Test n</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {results.kinds.map((k) => (
                  <tr key={k} className="text-slate-300">
                    <td className="px-3 py-1.5">{k}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{sel.per_kind[k].precision.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{sel.per_kind[k].recall.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{sel.per_kind[k].support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              Precision: of the procedures labeled this kind, how many truly were. Recall: of the ones that truly were
              this kind, how many it found. When the kind is right, the specific thing is right{' '}
              {pct(sel.within_kind_accuracy)} of the time.
            </p>
          </div>
          <KindConfusion matrix={sel.kind_confusion} />
        </div>

        <h3 className="mt-6 text-[11px] tracking-wide text-slate-500 uppercase">Most common specific mix-ups</h3>
        <ul className="mt-2 space-y-1 text-[12px] text-slate-400">
          {sel.top_leaf_confusions.slice(0, 6).map((c, i) => (
            <li key={i}>
              <span className="font-mono text-slate-500">{c.count}×</span> {leafLabel[c.truth]}{' '}
              <span className="text-slate-600">was labeled</span> {leafLabel[c.predicted]}
            </li>
          ))}
        </ul>

        <details className="mt-4 rounded border border-slate-800">
          <summary className="cursor-pointer px-3 py-2 text-[12px] text-slate-300">
            Confusion matrix for all {d.n_leaves} specific types (green diagonal = right, red = mix-up)
          </summary>
          <div className="p-3">
            <LeafConfusion matrix={sel.leaf_confusion} />
            <p className="mt-2 text-[11px] text-slate-600">Rows are the true type, columns the predicted one, both in the order listed above. Hover a cell for the names.</p>
          </div>
        </details>

        <details className="mt-4 rounded border border-slate-800">
          <summary className="cursor-pointer px-3 py-2 text-[12px] text-slate-300">
            All {d.n_leaves} specifics: precision, recall and F1
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Specific thing</th>
                  <th className="px-3 py-2 text-left font-medium">Kind</th>
                  <th className="px-3 py-2 text-right font-medium">Precision</th>
                  <th className="px-3 py-2 text-right font-medium">Recall</th>
                  <th className="px-3 py-2 text-right font-medium">F1</th>
                  <th className="px-3 py-2 text-right font-medium">Test n</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {results.leaves.map((l) => {
                  const s = sel.per_leaf[l.id];
                  return (
                    <tr key={l.id} className="text-slate-300">
                      <td className="px-3 py-1.5">{l.label}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{l.kind}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{s.precision.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{s.recall.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-200">{s.f1.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{s.support}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* Learned vs hand rules ------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Learned rules vs hand rules</h2>
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-[11px] tracking-wide text-slate-500 uppercase">Hand-written branching rules (frozen before training)</h3>
            <pre className="mt-2 overflow-x-auto rounded border border-slate-800 bg-slate-900/50 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              {results.hand_rules.join('\n')}
            </pre>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
              Step one decides the kind of check, and step two decides the specific thing inside it. The rules look only
              at keywords, so they ignore thresholds and units, and they cannot tell a keyword that is the topic of a
              definition from one that is mentioned only to rule it out.
            </p>
          </div>
          <div>
            <h3 className="text-[11px] tracking-wide text-slate-500 uppercase">
              Learned tree: top 3 levels of {results.tree.depth} ({results.tree.leaves} leaves in all)
            </h3>
            <pre className="mt-2 max-h-80 overflow-auto rounded border border-slate-800 bg-slate-900/50 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              {results.tree.learned_rules_top}
            </pre>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
              Most important features:{' '}
              {results.tree.top_features.slice(0, 6).map((f) => `${f.feature} (${f.importance.toFixed(2)})`).join(', ')}.
            </p>
          </div>
        </div>
      </section>

      {/* Feature check ---------------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Does any single feature give the answer away?</h2>
        <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
          Thresholds overlap between types and carry noise, and some come from an unrelated range entirely, so a number
          alone is weak evidence. Everything below uses the training set only. The most important feature in the tree
          ({results.feature_check.top_importance_feature}) carries {pct(results.feature_check.top_importance_share)} of the
          importance, and chance across {d.n_leaves} types is {pct(results.feature_check.chance)}.
        </p>
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">One feature on its own</th>
                  <th className="px-3 py-2 text-right font-medium">Accuracy (CV)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {results.feature_check.best_single_feature.map((f) => (
                  <tr key={f.feature} className="text-slate-300">
                    <td className="px-3 py-1.5 font-mono text-[11px]">{f.feature}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{pct(f.cv_accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-slate-600">The five strongest single features. None comes close to the full model.</p>
          </div>
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Tree with features removed</th>
                  <th className="px-3 py-2 text-right font-medium">Accuracy (CV)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {[
                  ['all_features', 'All features'],
                  ['without_threshold_features', 'Without threshold features'],
                  ['without_condition_features', 'Without condition features'],
                  ['without_both', 'Without both'],
                ].map(([k, label]) => (
                  <tr key={k} className="text-slate-300">
                    <td className="px-3 py-1.5">{label}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{pct(results.feature_check.ablation_cv_accuracy[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-slate-600">
              Removing the threshold or the condition features barely changes the result, which means the model is reading the text, the field name and the entity.
            </p>
          </div>
        </div>
      </section>

      {/* Where it works --------------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Where each method works and fails</h2>
        <div className="mt-3 overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Accuracy on the specific thing</th>
                {['informative', 'vague'].map((q) => (
                  <th key={q} className="px-3 py-2 text-right font-medium">{q} records</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {['rules_en', 'rules_multi', 'decision_tree', 'random_forest'].map((id) => (
                <tr key={id} className="text-slate-300">
                  <td className="px-3 py-1.5">{MODELS.find((x) => x.id === id).label}</td>
                  {['informative', 'vague'].map((q) => (
                    <td key={q} className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {pct(m[id].by_slice.record_quality[q].accuracy)}{' '}
                      <span className="text-slate-600">n={m[id].by_slice.record_quality[q].n}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
          Vague records have a generic title and description, so there is little text to go on. Every method struggles
          with them, and the tree falls back on the entity, the field name and the threshold.
        </p>
      </section>

      {/* Disagreements --------------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Where the tree and the English hand rules disagree</h2>
        <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
          They differ on {dis.n_differ} of {d.n_test} test records. The tree is right and the rules are wrong on{' '}
          {dis.summary.tree_right_rules_wrong}, the rules are right and the tree is wrong on {dis.summary.rules_right_tree_wrong},
          and both are wrong on {dis.summary.both_wrong}. A sample of each kind is below.
        </p>
        <div className="mt-3 overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Record</th>
                <th className="px-3 py-2 text-left font-medium">Truth</th>
                <th className="px-3 py-2 text-left font-medium">Tree</th>
                <th className="px-3 py-2 text-left font-medium">Rules</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {dis.examples.map((e) => (
                <tr key={e.id} className="align-top text-slate-300">
                  <td className="max-w-md px-3 py-2">
                    <div className="text-slate-200">{e.name ?? <span className="text-slate-600">(no name)</span>}</div>
                    <div className="text-[11px] text-slate-500">{e.description ?? '(no description)'}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-600">
                      {[e.entity, e.field, e.threshold, e.condition, e.language, e.vague ? 'vague' : null].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-300">{leafLabel[e.truth]}</td>
                  <td className={`px-3 py-2 text-[11px] ${e.tree === e.truth ? 'text-emerald-300' : 'text-rose-300'}`}>{leafLabel[e.tree]}</td>
                  <td className={`px-3 py-2 text-[11px] ${e.rules === e.truth ? 'text-emerald-300' : 'text-rose-300'}`}>{leafLabel[e.rules]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Limits ---------------------------------------------------------- */}
      <section className="max-w-3xl text-[14px] leading-[1.7] text-slate-400">
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">How it was run, and how far to trust it</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            {results.protocol.split}. Tuning: {results.protocol.tuning}. The test set was used {results.protocol.test_set_used}.
            An earlier version with 30 records per type was run once during development, and I replaced it with a version
            that follows a fixed checklist (at least 50 per type, noisier thresholds, a feature check and a full confusion
            matrix) instead of anything tuned to its test scores. Only the final run is reported.
          </li>
          <li>
            The data is synthetic: {d.n} generated records ({d.per_leaf} for each specific type) in English, German,
            Spanish and Japanese, including {d.vague_records} deliberately vague ones, with missing fields and mixed units.
            The generator assigns the label first, so it is known exactly. Many checks have no threshold by design, so
            that field is often empty.
          </li>
          <li>
            I wrote the taxonomy, the generator, the keyword lists and the hand rules, so their vocabulary overlaps and
            real documents would be harder. The accuracy is probably an overestimate.
          </li>
          <li>
            Thresholds are noisy and overlap between types, and removing the threshold or condition features barely
            changes the tree's accuracy, so the result does not rest on a single number. Real documents may still be
            messier than this generator.
          </li>
          <li>
            The forest scores higher than the tree but is much harder to read, so the tree is the headline: it can be
            explained rule by rule.
          </li>
        </ul>
      </section>
    </div>
  );
}
