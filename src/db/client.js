// Browser-side loader for the SQLite database.
//
// Two things are worth knowing here.
//
// The WASM binary is imported with Vite's `?url` suffix so it is emitted as a
// build asset and referenced by a hashed, RELATIVE path. vite.config.js sets
// `base: './'` so the build works from any GitHub Pages subpath, and hardcoding
// a wasm path would break that. locateFile() hands sql.js the URL Vite
// produced instead of letting it guess.
//
// The browser build is imported explicitly rather than through the bare
// `sql.js` specifier. The package's default entry carries Node `fs` fallbacks
// for locating the binary; the browser entry does not, which keeps those
// modules out of the bundle entirely.

import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { buildDatabase } from './build.js';

let loading = null;

/**
 * Initialise sql.js, build the seeded database, and cache it for the session.
 * Concurrent callers share one in-flight load.
 *
 * @returns {Promise<object>} a populated sql.js Database
 */
export function loadDatabase() {
  if (!loading) {
    loading = initSqlJs({ locateFile: () => wasmUrl })
      .then((SQL) => buildDatabase(SQL))
      .catch((error) => {
        loading = null; // let a later caller retry
        throw error;
      });
  }
  return loading;
}
