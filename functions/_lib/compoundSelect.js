// D1 refuses a compound SELECT with more than 5 terms ("too many terms in compound SELECT"; checked on the real D1
// 11.05: 5 works, 6 fails). Local tests use node:sqlite, whose limit is 500, so they can't catch it; that is how
// account deletion's 15-term file query shipped broken in L1. Long "UNION ALL" lists of independent SELECTs go
// through allUnionAll, which runs them in chunks of at most 5 terms and joins the rows. tools/d1-limits-test.mjs
// fails the build if any SQL in functions/ goes over the limit again.
export const MAX_COMPOUND_TERMS = 5;

// Splits on UNION ALL at the start of a line (how every long list here is written). Each term must be a plain
// SELECT with no UNION of its own.
export function unionAllTerms(sql) {
  return String(sql).split(/\n\s*UNION ALL\s+/i).map(t => t.trim()).filter(Boolean);
}

// Highest ?N a piece of SQL uses (numbered parameters only), so each chunk binds just the values it references.
function maxParam(sql) {
  let max = 0;
  for (const m of sql.matchAll(/\?(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

// Runs a long UNION ALL of independent SELECTs (numbered ?N parameters) and returns all rows, in term order.
// columns: the result column names, in SELECT order. A compound SELECT takes its column names from its FIRST term,
// so a later chunk (whose first term has no aliases) would come back with other names; rows are re-keyed by
// position so every chunk reads the same.
export async function allUnionAll(db, sql, params = [], columns = null) {
  const terms = unionAllTerms(sql);
  const rows = [];
  for (let i = 0; i < terms.length; i += MAX_COMPOUND_TERMS) {
    const chunk = terms.slice(i, i + MAX_COMPOUND_TERMS).join('\n  UNION ALL ');
    const res = await db.prepare(chunk).bind(...params.slice(0, maxParam(chunk))).all();
    for (const r of (res && res.results) || []) {
      if (!columns) { rows.push(r); continue; }
      const values = Object.values(r);
      rows.push(Object.fromEntries(columns.map((c, j) => [c, values[j]])));
    }
  }
  return rows;
}
