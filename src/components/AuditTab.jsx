// Read-only view over the SQL data layer in src/db/.
//
// Everything it shows is computed by SQLite in the browser at runtime rather
// than precomputed — the coverage counts come from each
// baseline's own coverageSql, and the miss rows from its own sql.
//
// No model calls. Generation is a Node-side concern (npm run gen:check); the
// browser never holds a key.

import { useEffect, useState } from 'react';
import { loadDatabase } from '../db/client.js';
import { runQuery, listTables } from '../db/query.js';
import { BASELINES, baselineParams } from '../db/baselines.js';
import { CANDIDATE_TABLES } from '../db/schema.js';
import { ANALYSIS_END } from '../db/seed/index.js';

const END = new Date(ANALYSIS_END).toISOString().replace('.000Z', 'Z');

/** Bind values only when the baseline declares parameters, as db-check does. */
function bindFor(baseline) {
  const params = baselineParams(baseline, { analysisEnd: END });
  return Object.keys(params).length > 0 ? { params } : {};
}

export default function AuditTab() {
  const [state, setState] = useState({ status: 'loading', error: null, data: null });
  const [selected, setSelected] = useState(BASELINES[0].asopId);

  useEffect(() => {
    let cancelled = false;

    loadDatabase()
      .then((db) => {
        // Tables and their row counts, straight out of sqlite_master.
        const tables = listTables(db).map((name) => ({
          name,
          rows: runQuery(db, `SELECT COUNT(*) AS n FROM ${name}`).rows[0].n,
          shape: CANDIDATE_TABLES[name]?.shape ?? null,
          summary: CANDIDATE_TABLES[name]?.summary ?? null,
        }));

        // Coverage per ASOP, from each baseline's own coverage query.
        const coverage = BASELINES.map((baseline) => {
          const result = runQuery(db, baseline.coverageSql, bindFor(baseline));
          const row = result.ok ? result.rows[0] : { qualifying: 0, logged: 0, missed: 0 };
          return { baseline, ...row, error: result.error };
        });

        // Miss rows per ASOP, from each baseline's detection query.
        const misses = Object.fromEntries(
          BASELINES.map((baseline) => [
            baseline.asopId,
            runQuery(db, baseline.sql, bindFor(baseline)),
          ]),
        );

        if (!cancelled) {
          setState({ status: 'ready', error: null, data: { tables, coverage, misses } });
        }
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', error: error.message, data: null });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return <p className="text-[13px] text-slate-500">Loading SQLite (wasm) and building the database…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="text-[13px] text-rose-400">
        The database did not load: <span className="font-mono">{state.error}</span>
      </p>
    );
  }

  const { tables, coverage, misses } = state.data;
  const baseline = BASELINES.find((entry) => entry.asopId === selected);
  const missResult = misses[selected];

  const totals = coverage.reduce(
    (sum, row) => ({
      qualifying: sum.qualifying + row.qualifying,
      logged: sum.logged + row.logged,
      missed: sum.missed + row.missed,
    }),
    { qualifying: 0, logged: 0, missed: 0 },
  );

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-[13px] leading-relaxed text-slate-500">
        A real SQLite database, built in the browser with sql.js from the seed
        rows in <span className="font-mono text-slate-400">src/db/</span>. Every
        number below is computed by SQLite at page load: the coverage counts come
        from each ASOP&rsquo;s own coverage query and the miss rows from its
        detection query. Nothing here is precomputed.
      </p>

      {/* Tables ------------------------------------------------------------ */}
      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">
          Tables <span className="ml-1 font-mono text-[11px] text-slate-500">{tables.length}</span>
        </h2>
        <div className="mt-3 overflow-hidden rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Table</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
                <th className="px-3 py-2 text-left font-medium">Shape</th>
                <th className="px-3 py-2 text-left font-medium">Detection semantics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {tables.map((table) => (
                <tr key={table.name} className="text-slate-300">
                  <td className="px-3 py-2 font-mono text-slate-200">{table.name}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                    {table.rows}
                  </td>
                  <td className="px-3 py-2">
                    {table.shape ? (
                      <span className="rounded bg-slate-800/70 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">
                        {table.shape}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-600">supporting</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{table.summary ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Coverage per ASOP -------------------------------------------------- */}
      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">
          Detection coverage
          <span className="ml-2 font-mono text-[11px] font-normal text-slate-500">
            {totals.missed} missed of {totals.qualifying} ·{' '}
            {((totals.missed / totals.qualifying) * 100).toFixed(1)}%
          </span>
        </h2>
        <p className="mt-1 text-[12px] text-slate-500">
          Select a row to see its baseline query and the misses it returns.
        </p>
        <div className="mt-3 overflow-hidden rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ASOP</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Table</th>
                <th className="px-3 py-2 text-right font-medium">Qualifying</th>
                <th className="px-3 py-2 text-right font-medium">Logged</th>
                <th className="px-3 py-2 text-right font-medium">Missed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {coverage.map((row) => {
                const isActive = row.baseline.asopId === selected;
                return (
                  <tr
                    key={row.baseline.asopId}
                    onClick={() => setSelected(row.baseline.asopId)}
                    className={[
                      'cursor-pointer transition-colors',
                      isActive ? 'bg-slate-800/60 text-slate-100' : 'text-slate-300 hover:bg-slate-900/60',
                    ].join(' ')}
                  >
                    <td className="px-3 py-2 font-mono text-slate-200">{row.baseline.asopId}</td>
                    <td className="px-3 py-2">{row.baseline.name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                      {row.baseline.table}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                      {row.qualifying}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                      {row.logged}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-300">
                      {row.missed}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Selected ASOP ------------------------------------------------------ */}
      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">
          {baseline.asopId} <span className="font-normal text-slate-400">{baseline.name}</span>
        </h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">
          {baseline.condition}
        </p>

        <h3 className="mt-4 text-[11px] tracking-wide text-slate-500 uppercase">Baseline query</h3>
        <pre className="mt-2 overflow-x-auto rounded border border-slate-800 bg-slate-900/50 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {baseline.sql.trim()}
        </pre>

        <h3 className="mt-5 text-[11px] tracking-wide text-slate-500 uppercase">
          Misses{' '}
          <span className="font-mono text-slate-400 normal-case">
            {missResult.ok ? missResult.rowCount : 'query failed'}
          </span>
        </h3>
        {!missResult.ok ? (
          <p className="mt-2 font-mono text-[12px] text-rose-400">{missResult.error}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  {missResult.columns.map((column) => (
                    <th key={column} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {missResult.rows.map((row, index) => (
                  <tr key={index} className="text-slate-300">
                    {missResult.columns.map((column) => (
                      <td
                        key={column}
                        className={[
                          'px-3 py-2 font-mono text-[11px] whitespace-nowrap',
                          // A bypass is attributed onto the row, never used to
                          // suppress it — these rows are misses like any other.
                          column === 'bypass' && row[column] !== null
                            ? 'text-amber-300'
                            : 'text-slate-400',
                        ].join(' ')}
                      >
                        {row[column] === null ? (
                          <span className="text-slate-700">—</span>
                        ) : (
                          String(row[column])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
