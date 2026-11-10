// D1 limits that node:sqlite (used by every other suite) doesn't enforce, so they can't be caught there:
// - a compound SELECT may have at most 5 terms (checked on the real D1 11.05: 5 works, 6 fails with
//   "too many terms in compound SELECT"). Account deletion shipped with 15 terms in L1 and failed in production.
// This suite scans every SQL string in functions/ and fails on a compound SELECT over the limit unless it is run
// through allUnionAll (functions/_lib/compoundSelect.js), then checks allUnionAll itself on node:sqlite.
// Usage: node --disable-warning=ExperimentalWarning tools/d1-limits-test.mjs <projectRoot>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = process.argv[2];
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name, detail ? `<<< ${detail}` : ''); } };

const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(join(root, 'functions'));

const LIMIT = 5;
const offenders = [];
let scanned = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/`[^`]*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g)) {
    const text = m[0];
    const terms = (text.match(/\bUNION\b/gi) || []).length + 1;
    if (terms <= LIMIT) continue;
    scanned++;
    // Allowed when this literal is handed to allUnionAll: either inline, or via the const it is assigned to.
    const before = src.slice(Math.max(0, m.index - 300), m.index);
    const constName = (/const\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before) || [])[1];
    const inline = /allUnionAll\(\s*db\s*,\s*$/.test(before);
    const viaConst = constName && new RegExp(`allUnionAll\\(\\s*db\\s*,\\s*${constName}\\b`).test(src);
    if (!inline && !viaConst) offenders.push(`${f.slice(root.length + 1)}:${src.slice(0, m.index).split('\n').length} (${terms} terms)`);
  }
}
check('every compound SELECT over 5 terms goes through allUnionAll', offenders.length === 0, offenders.join('; '));
check('the scan found the known long queries (account delete, pre-listing delete, seller report)', scanned >= 3, `found ${scanned}`);

// allUnionAll on a real SQLite: same rows as one big query, re-keyed by the given column names, binds only what
// each chunk uses.
const { allUnionAll, unionAllTerms, MAX_COMPOUND_TERMS } = await import(pathToFileURL(join(root, 'functions/_lib/compoundSelect.js')).href);
check('MAX_COMPOUND_TERMS is 5', MAX_COMPOUND_TERMS === 5);
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (id INTEGER, k TEXT)');
for (let i = 1; i <= 12; i++) db.prepare('INSERT INTO t VALUES (?, ?)').run(i, `key${i}`);
const prepared = [];
const D1 = { prepare(sql) { const st = { args: [], bind(...a) { st.args = a; return st; }, async all() { prepared.push({ sql, n: st.args.length }); return { results: db.prepare(sql).all(...st.args) }; } }; return st; } };
const terms = Array.from({ length: 12 }, (_, i) => i === 0 ? 'SELECT k AS k FROM t WHERE id = 1 AND ?1 = 1' : `SELECT k FROM t WHERE id = ${i + 1}${i === 7 ? ' AND ?3 = 3' : ''}`);
const big = terms.join('\n  UNION ALL ');
check('unionAllTerms splits on line-leading UNION ALL', unionAllTerms(big).length === 12);
const rows = await allUnionAll(D1, big, [1, 2, 3], ['k']);
check('12 terms run as 3 statements', prepared.length === 3, JSON.stringify(prepared.map(p => p.n)));
check('every chunk has at most 5 terms', prepared.every(p => (p.sql.match(/\bUNION\b/gi) || []).length + 1 <= 5));
check('all rows come back, in term order, under the given column name', JSON.stringify(rows.map(r => r.k)) === JSON.stringify(Array.from({ length: 12 }, (_, i) => `key${i + 1}`)), JSON.stringify(rows));
check('each chunk binds only up to the highest ?N it uses', JSON.stringify(prepared.map(p => p.n)) === JSON.stringify([1, 3, 0]), JSON.stringify(prepared.map(p => p.n)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
