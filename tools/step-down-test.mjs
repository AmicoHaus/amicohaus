// Nuanced ideas batch (role P): Step-Down Price. The owner of a trade listing publishes every step and date; the
// price changes by itself on those dates until they stop it. No private floor, no bids, no countdown, no "was" price.
// Real handlers and the lazy job on an in-memory SQLite stand-in for D1 (schema.sql). No network. Both launch states:
// the tool on (env.NUANCED_ALL_LIVE = '1') and the shipped gate (dark: "Not found." for everyone but an admin).
// Usage: node --disable-warning=ExperimentalWarning tools/step-down-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
// Counts every statement D1 would run (first/all/run, and each one in a batch) and keeps its SQL.
const stats = { statements: 0, log: [] };
const DB = {
  prepare(sql) {
    let args = [];
    const note = () => { stats.statements++; stats.log.push(sql.replace(/\s+/g, ' ').trim()); };
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { note(); return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { note(); return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { note(); const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => (/^\s*SELECT/i.test(sql) ? stmt.all() : stmt.run()),
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const reset = () => { stats.statements = 0; stats.log = []; };
const envLive = { DB, RESEND_API_KEY: 'test-key', NUANCED_ALL_LIVE: '1' };
const envShipped = { DB, RESEND_API_KEY: 'test-key' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; else passed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
globalThis.fetch = async () => new Response('{}', { status: 200 });
const callWith = (env) => async (handler, method, path, who, params = {}, body) => {
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  for (let i = 0; i < pending.length; i++) await pending[i];
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: type.includes('json') ? JSON.parse(text) : null };
};
const call = callWith(envLive);
const callShipped = callWith(envShipped);
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const exec = (sql, ...a) => sqlite.prepare(sql).run(...a);
const noStore = (r) => r.headers.get('Cache-Control') === 'private, no-store';
console.log = () => {};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const textOf = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const sqlUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const user = (id, name, extra = {}) => {
  exec('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, extra.email || `u${id}@example.test`, name, extra.role || 'user', extra.status || 'active');
  exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
// 1 owner Ana, 2 owner Bo, 5 admin, 6 approved agent Gil
user(1, 'Ana Owner'); user(2, 'Bo Owner'); user(5, 'Adm In', { role: 'admin' }); user(6, 'Gil Agent');
exec("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (6, 'approved', '01000006', 'Pacific Realty')");
const home = (id, owner, extra = {}) => {
  exec(`INSERT INTO listings (id, user_id, title, description, city, state, property_type, beds, baths, estimated_value, price_tier, is_rental, is_buyer_only, is_portfolio, status, client_name)
        VALUES (?, ?, ?, 'A home.', 'Chula Vista', 'CA', 'Single Family Home', 4, 3, ?, '600k-1m', ?, ?, ?, ?, ?)`,
  id, owner, `Home ${id}`, extra.value ?? 815000, extra.rental ? 1 : 0, extra.buyerOnly ? 1 : 0, extra.portfolio ? 1 : 0, extra.status || 'active', extra.client || null);
  if (!extra.rental) exec("INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (?, 'San Diego', 'Any', 0, 0, 0, 2000000)", id);
};
home(101, 1); home(102, 1, { rental: true }); home(103, 1, { buyerOnly: true }); home(104, 1, { portfolio: true }); home(105, 1, { status: 'paused' });
home(106, 6, { client: 'A Client' }); home(107, 2); home(108, 1); home(109, 5); home(110, 1);
exec('INSERT INTO portfolio_members (portfolio_listing_id, member_listing_id) VALUES (104, 110)');

const sd = await mod('functions/_lib/stepDown.js');
const gate = await mod('functions/_lib/nuancedGate.js');
const stepApi = await mod('functions/api/listings/[id]/step-down.js');
const listingOne = await mod('functions/api/listings/[id].js');
const trashItem = await mod('functions/api/listings/trash/[id].js');
const { pacificToUtcMs } = await mod('functions/_lib/agentDuty.js');

// ================= 1. Exact copy and the numbers =================
check('the fixed numbers: 7, 14 or 30 days; 1 to 8 steps; $1,000 or more a step', JSON.stringify(sd.STEP_DAYS) === '[7,14,30]' && sd.STEP_MAX_STEPS === 8 && sd.STEP_MIN_AMOUNT === 1000);
check('exact copy: heading, the not-an-auction line, the confirm line, the agent line', sd.STEP_HEADING === 'Price schedule (from the owner)'
  && sd.STEP_DOWN_LINE === "The owner published this schedule and can change or stop it at any time. It isn't an auction: there is no bidding, no deadline and no winner, and nothing sells by itself. An offer made on this page is a private note to the owner, who can say yes or no at any price. Each price is the owner's own number, not an appraisal."
  && sd.STEP_CONFIRM === "I understand my listing's price changes by itself on these dates until I stop the schedule."
  && sd.STEP_AGENT_ERROR === 'Price schedules are for owners posting their own home without an agent. With a listing agreement, price changes go through that agreement and the MLS.');
check('shipped gate: Step-Down Price is dark for a visitor and a member, on for an admin', !gate.toolLive({}, 'stepDown', null) && !gate.toolLive({}, 'stepDown', { role: 'user' }) && gate.toolLive({}, 'stepDown', { role: 'admin' }));

// ================= 2. validateStepDown =================
const active = { status: 'active', estimated_value: 815000 };
const good = { stepAmount: 10000, stepDays: 7, steps: 3, confirm: true };
const NOV10 = pacificToUtcMs(2026, 11, 10, 12, 0); // Tue Nov 10 2026, noon Pacific
let v = sd.validateStepDown(good, active, NOV10);
check('a good schedule: start price = the listing\'s price today, start date = today (Pacific)', JSON.stringify(v.data) === '{"startPrice":815000,"stepAmount":10000,"stepDays":7,"steps":3,"startDate":"2026-11-10"}', JSON.stringify(v));
check('the start date is the Pacific date, even late in the evening (already tomorrow in UTC)', sd.validateStepDown(good, active, pacificToUtcMs(2026, 11, 10, 22, 30)).data.startDate === '2026-11-10');
check('a rental, a buyer profile, a portfolio and a bundled home are refused', [{ is_rental: 1 }, { is_buyer_only: 1 }, { is_portfolio: 1 }, { bundled: 1 }].every(x => { const e = sd.validateStepDown(good, { ...active, ...x }, NOV10); return e.code === 'step_down_not_for_this_listing' && e.error === sd.STEP_KIND_ERROR && !e.data; }));
v = sd.validateStepDown(good, { ...active, status: 'paused' }, NOV10);
check('a paused listing is refused', v.code === 'step_down_not_active' && v.error === sd.STEP_PAUSED_ERROR);
v = sd.validateStepDown(good, { ...active, client_name: 'A Client' }, NOV10);
check('a listing posted for a client is refused with STEP_AGENT_ERROR', v.code === 'step_down_agent_listing' && v.error === sd.STEP_AGENT_ERROR);
check('step amount: whole dollars, $1,000 or more', [999, 0, -5000, 1500.5, 'abc', null, undefined].every(a => sd.validateStepDown({ ...good, stepAmount: a }, active, NOV10).error === sd.STEP_AMOUNT_ERROR) && !!sd.validateStepDown({ ...good, stepAmount: '1000' }, active, NOV10).data);
check('days between steps: 7, 14 or 30 only', [1, 10, 31, 0, '7 days'].every(n => sd.validateStepDown({ ...good, stepDays: n }, active, NOV10).error === sd.STEP_DAYS_ERROR) && [7, 14, 30].every(n => !!sd.validateStepDown({ ...good, stepDays: n }, active, NOV10).data));
check('steps: 1 to 8', [0, 9, 2.5, -1].every(n => sd.validateStepDown({ ...good, steps: n }, active, NOV10).error === sd.STEP_COUNT_ERROR) && !!sd.validateStepDown({ ...good, steps: 8 }, active, NOV10).data);
check('the last step can\'t go under half of the starting price', sd.validateStepDown({ ...good, stepAmount: 51000, steps: 8 }, active, NOV10).error === 'Keep the last step at or above half of your starting price.'
  && sd.validateStepDown({ ...good, stepAmount: 100000, steps: 5 }, active, NOV10).error === sd.STEP_HALF_ERROR);
check('...exactly half is allowed', !!sd.validateStepDown({ stepAmount: 100000, stepDays: 30, steps: 4, confirm: true }, { status: 'active', estimated_value: 800000 }, NOV10).data
  && sd.validateStepDown({ stepAmount: 100001, stepDays: 30, steps: 4, confirm: true }, { status: 'active', estimated_value: 800000 }, NOV10).error === sd.STEP_HALF_ERROR);
check('the confirm box must be ticked (true, not "yes")', sd.validateStepDown({ ...good, confirm: false }, active, NOV10).error === 'Tick the box to publish your schedule.' && sd.validateStepDown({ ...good, confirm: 'yes' }, active, NOV10).error === sd.STEP_CONFIRM_ERROR
  && sd.validateStepDown({ stepAmount: 10000, stepDays: 7, steps: 3 }, active, NOV10).error === sd.STEP_CONFIRM_ERROR);
check('the stored schedule has exactly five keys: no floor, reserve or minimum', JSON.stringify(Object.keys(sd.validateStepDown({ ...good, floor: 700000, reserve: 700000, minPrice: 1, lowest: 1 }, active, NOV10).data)) === '["startPrice","stepAmount","stepDays","steps","startDate"]');
const cols = q('PRAGMA table_info(listings)').map(c => c.name);
check('schema: no column for a private floor, reserve or minimum price', !cols.some(c => /floor|reserve|min_price|lowest|bid/.test(c)) && cols.includes('step_down_json') && cols.includes('step_next_at'));

// ================= 3. The state at fixed times (9:00 AM Pacific, across the November clock change) =================
// Start Tue Oct 20 2026, every 7 days, 3 steps: Oct 27 (PDT, 16:00 UTC), Nov 3 (PST, 17:00 UTC; clocks change Nov 1),
// Nov 10 (PST, 17:00 UTC).
const S = { startPrice: 815000, stepAmount: 10000, stepDays: 7, steps: 3, startDate: '2026-10-20' };
const T1 = Date.UTC(2026, 9, 27, 16, 0, 0), T2 = Date.UTC(2026, 10, 3, 17, 0, 0), T3 = Date.UTC(2026, 10, 10, 17, 0, 0);
check('fixture: 9:00 AM Pacific is 16:00 UTC before the clock change and 17:00 UTC after it', pacificToUtcMs(2026, 10, 27, 9, 0) === T1 && pacificToUtcMs(2026, 11, 3, 9, 0) === T2 && pacificToUtcMs(2026, 11, 10, 9, 0) === T3);
// Every day for two years (both clock changes, twice): each first step lands exactly on 9:00 AM Pacific.
{
  const off = [];
  for (let i = 0; i < 730; i++) {
    const day = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    const [y, m, d] = new Date(Date.UTC(2026, 9, 1 + i + 7)).toISOString().slice(0, 10).split('-').map(Number);
    const state = sd.stepDownState({ ...S, startDate: day, steps: 1 }, Date.UTC(2026, 0, 1));
    if (!state || state.nextAtMs !== pacificToUtcMs(y, m, d, 9, 0)) off.push(day);
  }
  check('every step time over two years is 9:00 AM Pacific (the same instant agentDuty.js pacificToUtcMs gives)', off.length === 0, off.slice(0, 5).join());
}
let st = sd.stepDownState(S, Date.UTC(2026, 9, 21, 0, 0, 0));
check('before the first step: the starting price now, then all three steps', st.currentPrice === 815000 && st.done === 0 && st.nextAtMs === T1 && st.lastPrice === 785000
  && JSON.stringify(st.rows) === '[{"label":"Now","price":815000},{"label":"Tue, Oct 27","price":805000},{"label":"Tue, Nov 3","price":795000},{"label":"Tue, Nov 10","price":785000}]', JSON.stringify(st));
st = sd.stepDownState(S, T1 - 1);
check('one millisecond before 9:00 AM Pacific on the step day: not yet', st.currentPrice === 815000 && st.done === 0);
st = sd.stepDownState(S, T1);
check('exactly at 9:00 AM Pacific on the step day: the step has taken effect', st.currentPrice === 805000 && st.done === 1 && st.nextAtMs === T2 && JSON.stringify(st.rows.map(r => r.label)) === '["Now","Tue, Nov 3","Tue, Nov 10"]', JSON.stringify(st));
st = sd.stepDownState(S, Date.UTC(2026, 10, 3, 16, 30, 0));
check('across the clock change: 16:30 UTC on Nov 3 is 8:30 AM Pacific, so the second step waits', st.currentPrice === 805000 && st.done === 1 && st.nextAtMs === T2);
st = sd.stepDownState(S, T2);
check('...and takes effect at 17:00 UTC (9:00 AM PST)', st.currentPrice === 795000 && st.done === 2 && st.nextAtMs === T3);
st = sd.stepDownState(S, T3 + 86400000);
check('after the last step: the last price, nothing still to come', st.currentPrice === 785000 && st.done === 3 && st.nextAtMs === null && JSON.stringify(st.rows) === '[{"label":"Now","price":785000}]' && st.lastPrice === 785000);
check('past prices are never listed (no row above the current price, at any time)', [Date.UTC(2026, 9, 21), T1, T2, T3, T3 + 1].every(t => { const s = sd.stepDownState(S, t); return s.rows.every(r => r.price <= s.currentPrice) && s.rows[0].label === 'Now' && s.rows[0].price === s.currentPrice; }));
check('stepNextAt: datetime(\'now\')-style text, or null after the last step', sd.stepNextAt(S, Date.UTC(2026, 9, 21)) === '2026-10-27 16:00:00' && sd.stepNextAt(S, T1) === '2026-11-03 17:00:00' && sd.stepNextAt(S, T3) === null && sd.stepNextAt(null, T1) === null);
check('no schedule, or one that doesn\'t hold together -> null', sd.stepDownState(null, T1) === null && sd.stepDownState({}, T1) === null && sd.stepDownState({ ...S, steps: 9 }, T1) === null && sd.stepDownState({ ...S, stepDays: 10 }, T1) === null
  && sd.stepDownState({ ...S, stepAmount: 500 }, T1) === null && sd.stepDownState({ ...S, startDate: '2026-02-30' }, T1) === null && sd.stepDownState({ ...S, stepAmount: 200000 }, T1) === null);
check('stepDownFromRow never throws', sd.stepDownFromRow(null) === null && sd.stepDownFromRow({ step_down_json: '{}' }) === null && sd.stepDownFromRow({ step_down_json: '{oops' }) === null && sd.stepDownFromRow({ step_down_json: '[1,2]' }) === null
  && JSON.stringify(sd.stepDownFromRow({ step_down_json: JSON.stringify(S) })) === JSON.stringify(S));
const rowS = { step_down_json: JSON.stringify(S), estimated_value: 815000, status: 'active' };
check('shownPrice: the schedule\'s current price while one runs, else the owner\'s number', sd.shownPrice(rowS, T1 - 1) === 815000 && sd.shownPrice(rowS, T1) === 805000 && sd.shownPrice(rowS, T3 + 5) === 785000 && sd.shownPrice({ step_down_json: '{}', estimated_value: 640000 }, T1) === 640000);

// ================= 4. The page block =================
let block = sd.stepDownBlockHtml(rowS, Date.UTC(2026, 9, 21));
check('the block: heading, Now and the steps still to come, the last-step line, the not-an-auction line', block === `<div class="mini-block step-schedule"><span class="label">${esc(sd.STEP_HEADING)}</span><ol><li class="step-now">Now: $815,000</li><li>Tue, Oct 27: $805,000</li><li>Tue, Nov 3: $795,000</li><li>Tue, Nov 10: $785,000</li></ol><p class="tiny">No further steps are scheduled after $785,000.</p><p class="tiny">${esc(sd.STEP_DOWN_LINE)}</p></div>`, block);
block = sd.stepDownBlockHtml(rowS, T2);
check('after two steps it lists Now and the one step left, never a price that has passed', block.includes('<li class="step-now">Now: $795,000</li><li>Tue, Nov 10: $785,000</li></ol>') && !block.includes('815,000') && !block.includes('805,000'));
check('after the last step there is no block', sd.stepDownBlockHtml(rowS, T3) === '');
check('no schedule, a rental, a buyer profile or a portfolio -> no block', sd.stepDownBlockHtml({ step_down_json: '{}' }, T1) === '' && sd.stepDownBlockHtml(null, T1) === '' && ['is_rental', 'is_buyer_only', 'is_portfolio'].every(k => sd.stepDownBlockHtml({ ...rowS, [k]: 1 }, T1 - 1) === ''));
const PRESSURE = /auction|bid(s|ding)?\b(?! are taken)|reserve|countdown|hurry|last chance|going once|% off|was \$|timer/i;
const everyBlock = [Date.UTC(2026, 9, 21), T1, T2].map(t => sd.stepDownBlockHtml(rowS, t)).join('');
check('the block has none of the pressure words outside its one not-an-auction line', !PRESSURE.test(textOf(everyBlock).split(sd.STEP_DOWN_LINE).join(' ')) && everyBlock.includes(esc(sd.STEP_DOWN_LINE)));
check('no strike-through, no clock: no <s>, <del>, line-through, hours or minutes', !/<s>|<s |<del|line-through|\d:\d\d|AM|PM|hours?|minutes?/.test(everyBlock));
check('every date is to the day ("Tue, Nov 3")', (everyBlock.match(/<li>[^<]+<\/li>/g) || []).every(li => /^<li>(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}: \$[\d,]+<\/li>$/.test(li)));
const libSrc = readFileSync(`${root}/functions/_lib/stepDown.js`, 'utf8');
const strings = [...libSrc.matchAll(/^export const STEP_\w+ = (['"])(.*)\1;$/gm)].map(m => m[2]).filter(s => s !== sd.STEP_DOWN_LINE.replace(/'/g, "\\'") && !s.includes("isn't an auction"));
check('no owner-facing string in stepDown.js uses a pressure word', strings.length >= 8 && strings.every(s => !PRESSURE.test(s)), strings.filter(s => PRESSURE.test(s)).join(' | '));

// ================= 5. PUT / DELETE /api/listings/:id/step-down =================
const put = (id, who, body, env = envLive) => callWith(env)(stepApi.onRequestPut, 'PUT', `/api/listings/${id}/step-down`, who, { id: String(id) }, body);
const del = (id, who, env = envLive) => callWith(env)(stepApi.onRequestDelete, 'DELETE', `/api/listings/${id}/step-down`, who, { id: String(id) });
let r = await put(101, 1, good, envShipped);
check('shipped gate, the owner: PUT -> 404 "Not found."', r.status === 404 && r.json.error === 'Not found.' && one('SELECT step_down_json FROM listings WHERE id = 101').step_down_json === '{}', JSON.stringify(r.json));
r = await put(101, null, good, envShipped);
check('shipped gate, signed out: PUT -> 404 (the route doesn\'t show itself)', r.status === 404);
r = await del(101, 1, envShipped);
check('shipped gate, the owner: DELETE -> 404', r.status === 404);
r = await put(109, 5, good, envShipped);
check('shipped gate, an admin on their own listing: it works (the walk-through)', r.status === 200 && one('SELECT step_next_at FROM listings WHERE id = 109').step_next_at !== null, JSON.stringify(r.json));
r = await put(101, 5, good, envShipped);
check('...but an admin can\'t publish a schedule on someone else\'s listing', r.status === 403 && one('SELECT step_down_json FROM listings WHERE id = 101').step_down_json === '{}');
r = await put(101, null, good);
check('live, signed out -> 401', r.status === 401);
r = await put(101, 2, good);
check('live, another member -> 403', r.status === 403);
r = await put(999999, 1, good);
check('a listing that isn\'t there -> 404', r.status === 404);
for (const [id, code, label] of [[102, 'step_down_not_for_this_listing', 'a rental'], [103, 'step_down_not_for_this_listing', 'a buyer-only profile'], [104, 'step_down_not_for_this_listing', 'a portfolio'],
  [110, 'step_down_not_for_this_listing', 'a home bundled into a portfolio'], [105, 'step_down_not_active', 'a paused listing']]) {
  r = await put(id, 1, good);
  check(`refused for ${label}: 400 ${code}`, r.status === 400 && r.json.code === code && one('SELECT step_down_json FROM listings WHERE id = ?', id).step_down_json === '{}', JSON.stringify(r.json));
}
r = await put(106, 6, good);
check('refused for a client listing: 400 step_down_agent_listing with STEP_AGENT_ERROR', r.status === 400 && r.json.code === 'step_down_agent_listing' && r.json.error === sd.STEP_AGENT_ERROR, JSON.stringify(r.json));
// An approved agent's own listing with no client name (review fix): the same "agent-posted" rule as the head start.
home(111, 6);
r = await put(111, 6, good);
check('refused for an approved agent\'s own listing with no client name: 400 step_down_agent_listing, nothing stored, no limit claimed', r.status === 400 && r.json.code === 'step_down_agent_listing' && r.json.error === sd.STEP_AGENT_ERROR
  && one('SELECT step_down_json FROM listings WHERE id = 111').step_down_json === '{}' && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 6 AND kind = 'step_down_edit'").n === 0, JSON.stringify(r.json));
check('validateStepDown: agent_owner alone is refused; a plain owner is not', sd.validateStepDown(good, { status: 'active', estimated_value: 815000, agent_owner: 1 }).code === 'step_down_agent_listing'
  && !!sd.validateStepDown(good, { status: 'active', estimated_value: 815000, agent_owner: null }).data);
check('the agent line names no client question and promises nothing', sd.STEP_AGENT_ERROR === 'Price schedules are for owners posting their own home without an agent. With a listing agreement, price changes go through that agreement and the MLS.');
r = await put(101, 1, { ...good, confirm: false });
check('without the confirm tick -> 400, nothing stored, no limit claimed', r.status === 400 && r.json.error === 'Tick the box to publish your schedule.' && one('SELECT step_down_json FROM listings WHERE id = 101').step_down_json === '{}'
  && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 1 AND kind = 'step_down_edit'").n === 0);
r = await put(101, 1, { ...good, stepAmount: 60000, steps: 8 });
check('under half -> 400 with the exact error', r.status === 400 && r.json.error === 'Keep the last step at or above half of your starting price.');
reset();
r = await put(101, 1, good);
let row = one('SELECT step_down_json, step_next_at, estimated_value FROM listings WHERE id = 101');
const stored = JSON.parse(row.step_down_json);
check('the owner publishes a schedule', r.status === 200 && r.json.ok === true && noStore(r) && stored.startPrice === 815000 && stored.stepAmount === 10000 && stored.stepDays === 7 && stored.steps === 3 && /^\d{4}-\d\d-\d\d$/.test(stored.startDate) && row.estimated_value === 815000, JSON.stringify(r.json));
check('...step_next_at is the first step, 9:00 AM Pacific, as datetime(\'now\')-style text', row.step_next_at === sd.stepNextAt(stored, Date.now()) && /^\d{4}-\d\d-\d\d 1[67]:00:00$/.test(row.step_next_at), row.step_next_at);
check('...in 3 statements + the session: the listing, the limit, ONE UPDATE', stats.statements === 4 && stats.log.filter(s => s.startsWith('UPDATE listings')).length === 1 && stats.log.filter(s => s.startsWith('INSERT INTO user_action_log')).length === 1, stats.log.map(s => s.slice(0, 40)).join(' | '));
check('...and the response carries the schedule the app re-renders from', JSON.stringify(r.json.stepDown) === row.step_down_json);
reset();
r = await del(101, 1);
row = one('SELECT step_down_json, step_next_at, estimated_value FROM listings WHERE id = 101');
check('the owner stops it: no schedule, the price stays where it is', r.status === 200 && row.step_down_json === '{}' && row.step_next_at === null && row.estimated_value === 815000);
check('...in 2 statements + the session', stats.statements === 3, stats.log.map(s => s.slice(0, 40)).join(' | '));
r = await del(101, 2);
check('someone else can\'t stop it', r.status === 403);
for (let i = 0; i < 5; i++) r = await put(101, 1, good);
check('six schedule changes a day, then the limit', r.status === 200);
r = await put(101, 1, good);
check('...the seventh -> 429', r.status === 429 && r.json.code === 'rate_limited');
exec("DELETE FROM user_action_log WHERE kind = 'step_down_edit'");

// ================= 6. The job =================
const job = (nowMs) => sd.runDueStepDowns({ env: envLive }, nowMs);
const setSchedule = (id, schedule, nowMs, extra = '') => exec(`UPDATE listings SET step_down_json = ?, step_next_at = ?, estimated_value = ?${extra} WHERE id = ?`, JSON.stringify(schedule), sd.stepNextAt(schedule, nowMs), schedule.startPrice, id);
exec("UPDATE listings SET step_down_json = '{}', step_next_at = NULL");
const drops = (id) => q("SELECT headline, amount, delta FROM market_events WHERE event_type = 'price_drop' AND entity_id = ? ORDER BY id", id);
reset();
await job(T1);
check('nothing due: 1 statement, nothing changes', stats.statements === 1 && stats.log[0].startsWith('SELECT id, user_id, city, state, estimated_value, step_down_json, step_next_at FROM listings'), stats.log.join(' | '));
setSchedule(101, S, Date.UTC(2026, 9, 21));
reset();
await job(T1 - 1000);
check('not due yet: still 1 statement, the price is unchanged', stats.statements === 1 && one('SELECT estimated_value FROM listings WHERE id = 101').estimated_value === 815000);
reset();
await job(T1);
row = one('SELECT estimated_value, price_tier, step_next_at, step_down_json FROM listings WHERE id = 101');
check('a due listing takes its step: the price, the tier, the next time; the schedule stays', row.estimated_value === 805000 && row.step_next_at === '2026-11-03 17:00:00' && row.step_down_json === JSON.stringify(S) && typeof row.price_tier === 'string', JSON.stringify(row));
check('...one price_drop event, the same shape the edit path writes', drops(101).length === 1 && drops(101)[0].headline === 'Price drop in Chula Vista, CA: $815,000 → $805,000' && drops(101)[0].amount === 805000 && drops(101)[0].delta === -10000, JSON.stringify(drops(101)));
check('...about 3 statements for the step (claim, owner check, event), plus the SELECT; no notification, no email', stats.statements >= 4 && stats.statements <= 5 && one('SELECT COUNT(*) AS n FROM notifications').n === 0, String(stats.statements));
await job(T1 + 60000);
check('running again doesn\'t step it twice', one('SELECT estimated_value FROM listings WHERE id = 101').estimated_value === 805000 && drops(101).length === 1);
// Two runs at the same moment: one claim wins.
setSchedule(107, S, Date.UTC(2026, 9, 21));
await Promise.all([job(T1), job(T1)]);
check('two runs at once: one claim wins (one step, one event)', one('SELECT estimated_value FROM listings WHERE id = 107').estimated_value === 805000 && drops(107).length === 1, JSON.stringify(drops(107)));
// A paused listing waits, then catches up in one move.
setSchedule(108, S, Date.UTC(2026, 9, 21), ", status = 'paused'");
await job(T2 + 1000);
check('a paused listing is skipped (and listing 101 took its second step)', one('SELECT estimated_value FROM listings WHERE id = 108').estimated_value === 815000 && drops(108).length === 0 && one('SELECT estimated_value FROM listings WHERE id = 101').estimated_value === 795000);
exec("UPDATE listings SET status = 'active' WHERE id = 108");
await job(T2 + 2000);
row = one('SELECT estimated_value, step_next_at FROM listings WHERE id = 108');
check('active again: it catches up in one move (two steps, one event)', row.estimated_value === 795000 && row.step_next_at === '2026-11-10 17:00:00' && drops(108).length === 1 && drops(108)[0].headline === 'Price drop in Chula Vista, CA: $815,000 → $795,000' && drops(108)[0].delta === -20000, JSON.stringify(drops(108)));
// The final step clears the schedule.
await job(T3);
row = one('SELECT estimated_value, step_next_at, step_down_json FROM listings WHERE id = 101');
check('the final step writes the last price and clears the schedule', row.estimated_value === 785000 && row.step_next_at === null && row.step_down_json === '{}' && drops(101).length === 3, JSON.stringify(row));
reset();
await job(T3 + 30 * 86400000);
check('after that nothing is ever due again (1 statement)', stats.statements === 1 && one('SELECT estimated_value FROM listings WHERE id = 101').estimated_value === 785000 && one('SELECT estimated_value FROM listings WHERE id = 107').estimated_value === 785000);
// At most 3 a pass; a hidden (moderation-paused) or bundled home never steps; a broken schedule is cleared.
exec("UPDATE listings SET step_down_json = '{}', step_next_at = NULL, estimated_value = 815000, status = 'active'");
for (const id of [101, 107, 108, 109]) setSchedule(id, S, Date.UTC(2026, 9, 21));
await job(T1);
check('at most 3 listings step in one pass; the rest wait for the next', q('SELECT id FROM listings WHERE estimated_value = 805000').length === 3);
await job(T1);
check('...and the next pass takes the fourth', q('SELECT id FROM listings WHERE estimated_value = 805000').length === 4);
setSchedule(110, S, Date.UTC(2026, 9, 21));
exec("UPDATE listings SET step_down_json = '{broken', step_next_at = '2026-10-27 16:00:00' WHERE id = 105");
exec("UPDATE listings SET status = 'active' WHERE id = 105");
await job(T2);
check('a home bundled into a portfolio never steps', one('SELECT estimated_value FROM listings WHERE id = 110').estimated_value === 815000);
check('a schedule that can\'t be read is cleared, and the price stays', JSON.stringify(one('SELECT step_down_json, step_next_at, estimated_value FROM listings WHERE id = 105')) === '{"step_down_json":"{}","step_next_at":null,"estimated_value":815000}');
check('the job never writes a notification or an email row', one('SELECT COUNT(*) AS n FROM notifications').n === 0);
const jobSrc = libSrc.slice(libSrc.indexOf('export async function runDueStepDowns'));
check('the job claims each row by its old step_next_at and takes at most 3 a pass', jobSrc.includes('WHERE id = ? AND step_next_at = ?') && /LIMIT 3/.test(jobSrc) && !/sendEmail|notifyAndMaybeEmail|INSERT INTO notifications|sendPush/.test(libSrc));
const mw = readFileSync(`${root}/functions/api/_middleware.js`, 'utf8');
check('the lazy-job runner calls runDueStepDowns', /runDueHeadStarts, runDueStepDowns, runPurgeExpiredTrash/.test(mw));

// ================= 7. A manual price change stops the schedule =================
exec("UPDATE listings SET step_down_json = '{}', step_next_at = NULL, estimated_value = 815000, status = 'active'");
setSchedule(101, S, Date.UTC(2026, 9, 21));
const editBody = { action: 'edit', title: 'Home 101', description: 'A home.', city: 'Chula Vista', state: 'CA', propertyType: 'Single Family Home', estimatedValue: 815000, beds: 4, baths: 3,
  locations: 'San Diego', desiredType: 'Any', priceMin: 0, priceMax: 2000000, minBeds: 0, minBaths: 0 };
r = await call(listingOne.onRequestPut, 'PUT', '/api/listings/101', 1, { id: '101' }, { ...editBody, title: 'Home 101, edited' });
check('an edit that keeps the price keeps the schedule', r.status === 200 && !('stepDownStopped' in r.json) && one('SELECT step_next_at FROM listings WHERE id = 101').step_next_at !== null);
r = await call(listingOne.onRequestPut, 'PUT', '/api/listings/101', 1, { id: '101' }, { ...editBody, estimatedValue: 800000 });
row = one('SELECT estimated_value, step_down_json, step_next_at FROM listings WHERE id = 101');
check('an edit that changes the price clears the schedule and says so', r.status === 200 && r.json.stepDownStopped === true && row.estimated_value === 800000 && row.step_down_json === '{}' && row.step_next_at === null, JSON.stringify(r.json) + JSON.stringify(row));
{
  // The listing form (main.js) reads that answer and adds the line from listing-terms.js to its "updated" toast.
  const mainSrc = readFileSync(`${root}/main.js`, 'utf8');
  check('the listing form tells the owner the schedule was stopped', mainSrc.includes('saved.stepDownStopped') && mainSrc.includes('LT_STEP_STOPPED_LINE')
    && readFileSync(`${root}/listing-terms.js`, 'utf8').includes("const LT_STEP_STOPPED_LINE = 'Your price schedule was stopped because you changed the price.';"));
}
// Naming a client on a home that carries a schedule stops the schedule (review fix), and the job never steps a
// client's home even if a schedule were left on it.
{
  setSchedule(111, S, Date.UTC(2026, 9, 21));
  const agentEdit = { ...editBody, title: 'Home 111' };
  let e = await call(listingOne.onRequestPut, 'PUT', '/api/listings/111', 6, { id: '111' }, agentEdit);
  check('an agent\'s edit with no client name keeps a schedule that is already there', e.status === 200 && !('stepDownStopped' in e.json) && one('SELECT step_next_at FROM listings WHERE id = 111').step_next_at !== null);
  e = await call(listingOne.onRequestPut, 'PUT', '/api/listings/111', 6, { id: '111' }, { ...agentEdit, clientName: 'Pat Client' });
  const after = one('SELECT client_name, estimated_value, step_down_json, step_next_at FROM listings WHERE id = 111');
  check('adding a client name stops the schedule and says why; the price stays', e.status === 200 && e.json.stepDownStopped === true && e.json.stepDownStoppedFor === 'client'
    && JSON.stringify(after) === '{"client_name":"Pat Client","estimated_value":815000,"step_down_json":"{}","step_next_at":null}', JSON.stringify(e.json) + JSON.stringify(after));
  check('the app has a line for that', readFileSync(`${root}/listing-terms.js`, 'utf8').includes("const LT_STEP_STOPPED_CLIENT_LINE = 'Your price schedule was stopped because this home is now posted for a client.';")
    && readFileSync(`${root}/main.js`, 'utf8').includes("saved.stepDownStoppedFor === 'client'"));
  setSchedule(111, S, Date.UTC(2026, 9, 21));
  const dropsBefore = drops(111).length;
  await job(T3 + 86400000);
  const held = one('SELECT estimated_value, step_next_at FROM listings WHERE id = 111');
  check('the job never steps a home posted for a client (no price change, no price_drop event)', held.estimated_value === 815000 && held.step_next_at !== null && drops(111).length === dropsBefore, JSON.stringify(held));
  exec("UPDATE listings SET step_down_json = '{}', step_next_at = NULL, client_name = NULL WHERE id = 111");
}
r = await call(listingOne.onRequestPut, 'PUT', '/api/listings/101', 1, { id: '101' }, { ...editBody, estimatedValue: 790000 });
check('a price change with no schedule running says nothing about one', r.status === 200 && !('stepDownStopped' in r.json));
setSchedule(101, { ...S, startPrice: 790000 }, Date.UTC(2026, 9, 21));
r = await call(listingOne.onRequestPut, 'PUT', '/api/listings/101', 1, { id: '101' }, { status: 'paused' });
check('pausing keeps the schedule', r.status === 200 && one('SELECT step_next_at FROM listings WHERE id = 101').step_next_at !== null);
await call(listingOne.onRequestPut, 'PUT', '/api/listings/101', 1, { id: '101' }, { status: 'active' });

// ================= 8. Who sees the schedule, and the trash =================
r = await callShipped(listingOne.onRequestGet, 'GET', '/api/listings/101', 2, { id: '101' });
check('shipped gate: another member\'s JSON has no step_down_json or step_next_at', r.status === 200 && !('step_down_json' in r.json.listing) && !('step_next_at' in r.json.listing));
r = await call(listingOne.onRequestGet, 'GET', '/api/listings/101', 2, { id: '101' });
check('live: the schedule is in the JSON (every step is public)', 'step_down_json' in r.json.listing);
await call(listingOne.onRequestDelete, 'DELETE', '/api/listings/101', 1, { id: '101' });
const trashRow = one('SELECT id FROM deleted_listings WHERE user_id = 1 ORDER BY id DESC');
r = await call(trashItem.onRequestPost, 'POST', `/api/listings/trash/${trashRow.id}`, 1, { id: String(trashRow.id) });
row = one('SELECT step_down_json, step_next_at, estimated_value FROM listings WHERE id = ?', r.json.id);
check('a restored listing comes back with no schedule', r.status === 200 && row.step_down_json === '{}' && row.step_next_at === null && row.estimated_value === 790000, JSON.stringify(row));

// ================= 9. The app (listing-terms.js): the same math and strings =================
const clientSrc = readFileSync(`${root}/listing-terms.js`, 'utf8');
const makeBox = (tools) => {
  const box = { window: { NUANCED: tools }, console: { log() {} } };
  vm.createContext(box);
  vm.runInContext(`${clientSrc}\n;Object.assign(globalThis, { LT: { LT_STEP_DAYS, LT_STEP_MAX_STEPS, LT_STEP_MIN_AMOUNT, LT_STEP_HEADING, LT_STEP_DOWN_LINE, LT_STEP_CONFIRM, LT_STEP_AGENT_ERROR, LT_STEP_HALF_ERROR, LT_STEP_PANEL_HELP, LT_STEP_STOPPED_LINE }, ltStepStateOut: ltStepState, ltStepBlockOut: ltStepBlockHtml, ltStepPreviewOut: ltStepPreviewHtml, ltStepPanelInnerOut: ltStepPanelInnerHtml });`, box);
  return box;
};
const app = makeBox(gate.liveTools({ NUANCED_ALL_LIVE: '1' }));
const appShipped = makeBox(gate.liveTools({}, null));
check('client constants match stepDown.js', JSON.stringify(app.LT.LT_STEP_DAYS) === JSON.stringify(sd.STEP_DAYS) && app.LT.LT_STEP_MAX_STEPS === sd.STEP_MAX_STEPS && app.LT.LT_STEP_MIN_AMOUNT === sd.STEP_MIN_AMOUNT && app.LT.LT_STEP_HEADING === sd.STEP_HEADING
  && app.LT.LT_STEP_DOWN_LINE === sd.STEP_DOWN_LINE && app.LT.LT_STEP_CONFIRM === sd.STEP_CONFIRM && app.LT.LT_STEP_AGENT_ERROR === sd.STEP_AGENT_ERROR && app.LT.LT_STEP_HALF_ERROR === sd.STEP_HALF_ERROR);
const SCHEDULES = [
  [S, Date.UTC(2026, 9, 21)], [S, T1], [S, Date.UTC(2026, 10, 3, 16, 30, 0)], [S, T2], [S, T3],
  [{ startPrice: 1200000, stepAmount: 25000, stepDays: 30, steps: 8, startDate: '2026-12-15' }, Date.UTC(2027, 2, 20)],
  [{ startPrice: 640000, stepAmount: 1000, stepDays: 14, steps: 1, startDate: '2027-03-01' }, Date.UTC(2027, 2, 2)],
];
SCHEDULES.forEach(([schedule, at], i) => {
  const server = sd.stepDownState(schedule, at);
  const client = app.ltStepStateOut(schedule, at);
  check(`client state === server state, fixture ${i + 1}`, JSON.stringify(client) === JSON.stringify(server), `${JSON.stringify(client)} vs ${JSON.stringify(server)}`);
  check(`client block === server block, fixture ${i + 1}`, app.ltStepBlockOut(schedule, at) === sd.stepDownBlockHtml({ step_down_json: JSON.stringify(schedule) }, at));
});
const listing = { id: 101, estimated_value: 815000, step_down_json: '{}', status: 'active' };
const panel = app.ltStepDownPanelHtml(listing);
check('the owner panel (no schedule yet): the three fields, the help, the confirm box, Publish schedule', panel.startsWith('<div data-lt-step="101">') && panel.includes('<label for="ltStepAmount101">Step my price down by ($)</label>')
  && panel.includes('<label for="ltStepDays101">Every</label>') && ['7 days', '14 days', '30 days'].every(o => panel.includes(`>${o}</option>`)) && panel.includes('<label for="ltStepCount101">How many steps</label>')
  && [1, 8].every(n => panel.includes(`<option value="${n}">${n}</option>`)) && !panel.includes('<option value="9">')
  && panel.includes('Buyers see every step and date. There is no hidden lowest price: the last step you publish is the lowest price on the schedule.')
  && panel.includes(`<label class="checkbox-row" for="ltStepConfirm101"><input type="checkbox" id="ltStepConfirm101"><span>${esc(sd.STEP_CONFIRM)}</span></label>`)
  && panel.includes('data-action="lt-step-publish" data-id="101">Publish schedule</button>'), panel.slice(0, 400));
check('the confirm box starts unticked', !/ltStepConfirm101"[^>]*checked/.test(panel));
const running = app.ltStepPanelInnerOut({ ...listing, step_down_json: JSON.stringify(S) }, Date.UTC(2026, 9, 21));
check('while a schedule runs: the same list the page shows, and "Stop the schedule"', running === `${sd.stepDownBlockHtml(rowS, Date.UTC(2026, 9, 21))}<div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="lt-step-stop" data-id="101">Stop the schedule</button></div>`, running);
check('the preview uses the same math, and names the half rule', app.ltStepPreviewOut(listing, 10000, 7, 3, Date.UTC(2026, 9, 20, 20)) === sd.stepDownBlockHtml(rowS, Date.UTC(2026, 9, 20, 20))
  && app.ltStepPreviewOut(listing, 60000, 7, 8, T1) === `<p class="tiny">${esc(sd.STEP_HALF_ERROR)}</p>` && app.ltStepPreviewOut(listing, 0, 7, 3, T1) === '');
check('a client listing shows the agent line instead of the form', app.ltStepDownPanelHtml({ ...listing, client_name: 'A Client' }) === `<div data-lt-step="101"><p class="tiny">${esc(sd.STEP_AGENT_ERROR)}</p></div>`);
check('nothing for a rental, a buyer profile, a portfolio or a bundled home', [{ is_rental: 1 }, { is_buyer_only: 1 }, { is_portfolio: 1 }, { bundled_into: 104 }].every(x => app.ltStepDownPanelHtml({ ...listing, ...x }) === ''));
check('shipped gate: no panel at all', appShipped.ltStepDownPanelHtml(listing) === '' && appShipped.ltStepDownPanelHtml({ ...listing, step_down_json: JSON.stringify(S) }) === '');
check('the "stopped because you changed the price" line is ready for the listing form', app.LT.LT_STEP_STOPPED_LINE === 'Your price schedule was stopped because you changed the price.');
const stepSrc = clientSrc.slice(clientSrc.indexOf('// ---- Step-Down Price (the same math'), clientSrc.indexOf('// ---- Delegated listeners'));
check('the app\'s step-down code has no pressure word, strike-through or clock', !PRESSURE.test(stepSrc) && !/<s>|<del|line-through|setInterval|setTimeout/.test(clientSrc));
check('no \\x08 byte in the step-down files', ['functions/_lib/stepDown.js', 'functions/api/listings/[id]/step-down.js', 'listing-terms.js', 'functions/api/listings/[id].js'].every(f => !readFileSync(`${root}/${f}`, 'utf8').includes('\x08')));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
