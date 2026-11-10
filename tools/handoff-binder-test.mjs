// Runs the real code for the handoff binder (owner tools batch) against an in-memory SQLite stand-in for D1: owner
// only (the hired agent, other agents and admins get 403), codes refused, field and size caps, photo ids limited to
// the home's current photos (stale ones dropped), unknown keys dropped, the printable page (banners, footer, address
// switch, "Print Binder", CSP-safe, noindex, private no-store), and that the binder never rides along on the detail
// GET or any admin route but is in the owner's export. Also the client panel in a stubbed browser. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/handoff-binder-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const read = (f) => readFileSync(`${root}/${f}`, 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON;');
sqlite.exec(read('schema.sql'));
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => (/^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : stmt.run()),
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const objects = new Map();
const PHOTOS = {
  put: async (key, body) => { objects.set(key, body); },
  get: async (key) => (objects.has(key) ? { body: objects.get(key) } : null),
  head: async (key) => (objects.has(key) ? { size: 1 } : null),
  delete: async (key) => { objects.delete(key); },
};
const env = { DB, PHOTOS, EMAIL_DEV_LOG: '1' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
globalThis.fetch = async () => new Response('{}', { status: 200 });
const call = async (handler, method, who, params = {}, body) => {
  const request = new Request('https://amicohaus.com/api/x', {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: type.includes('json') && text ? JSON.parse(text) : null };
};
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const noStore = (r) => /private/.test(r.headers.get('Cache-Control') || '') && /no-store/.test(r.headers.get('Cache-Control') || '');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
console.log = () => {};

const user = (id, extra = {}) => {
  run('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)', id, `u${id}@example.test`, `User ${id}`, extra.role ?? 'user');
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
const lib = await mod('functions/_lib/handoffBinder.js');
const { CODE_ERROR } = await mod('functions/_lib/homeText.js');
const api = await mod('functions/api/pre-listings/[id]/binder.js');
const page = await mod('functions/pre-listing/[id]/binder.js');
const detail = await mod('functions/api/pre-listings/[id].js');
const exportApi = await mod('functions/api/account/export.js');
const { renderFlyerShell } = await mod('functions/_lib/flyerShell.js');

// 1 owner of home 10 (awarded to agent 2), 2 hired agent, 3 other approved agent, 5 admin, 6 admin + approved agent,
// 7 owner of home 20.
for (const id of [1, 2, 3, 7]) user(id);
user(5, { role: 'admin' }); user(6, { role: 'admin' });
for (const id of [2, 3, 6]) run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, 'approved', '01234567', 'Realty')", id);
for (const [id, owner, status] of [[10, 1, 'awarded'], [20, 7, 'open']]) {
  run(`INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, address, status)
       VALUES (?, ?, 'Home', 'Chula Vista', 'CA', '91913', 'Townhouse', 3, 2, 750000, '1218 La Vida Ct', ?)`, id, owner, status);
}
run("INSERT INTO service_bids (id, request_type, request_id, agent_user_id, commission_pct, status) VALUES (1, 'pre_listing', 10, 2, 2.5, 'accepted')");
run('UPDATE pre_listings SET awarded_bid_id = 1 WHERE id = 10');
for (const [id, homeId] of [[31, 10], [32, 10], [33, 10], [39, 20]]) run("INSERT INTO pre_listing_photos (id, pre_listing_id, r2_key, content_type, position) VALUES (?, ?, ?, 'image/jpeg', ?)", id, homeId, `k${id}`, id);
const P10 = { id: '10' };

// ---- 1. Who can open it ----
let r = await call(api.onRequestGet, 'GET', 1, P10);
check('owner GET: an empty binder with every default, the home\'s photo ids, private no-store',
  r.status === 200 && noStore(r) && Object.keys(r.json.binder.sections).join() === 'water_yard,power_gas,paint_finishes,trash,hoa_amenities,next_owner_notes'
  && Object.values(r.json.binder.sections).every(v => v === '') && r.json.binder.printAddress === true && r.json.binder.appliances.length === 0
  && r.json.photoIds.join() === '31,32,33' && r.json.updatedAt === null, r.text);
for (const [who, label] of [[2, 'the hired agent'], [3, 'another approved agent'], [5, 'an admin'], [6, 'the operator (admin + agent)'], [7, 'another homeowner']]) {
  r = await call(api.onRequestGet, 'GET', who, P10);
  check(`API: ${label} gets 403 "Only the homeowner can open the binder."`, r.status === 403 && r.json.error === 'Only the homeowner can open the binder.', r.text);
  r = await call(api.onRequestPut, 'PUT', who, P10, { sections: {} });
  check(`API PUT: ${label} gets 403`, r.status === 403);
  r = await call(page.onRequestGet, 'GET', who, P10);
  check(`print page: ${label} gets 403`, r.status === 403 && !r.text.includes('binder-print'));
}
r = await call(api.onRequestGet, 'GET', null, P10);
check('API: signed out 401', r.status === 401);
r = await call(page.onRequestGet, 'GET', null, P10);
check('print page: signed out 401 (text)', r.status === 401 && /Sign in/.test(r.text));
r = await call(api.onRequestGet, 'GET', 1, { id: '999' });
check('API: a missing home 404', r.status === 404);
r = await call(page.onRequestGet, 'GET', 1, { id: '999' });
check('print page: a missing home 404', r.status === 404);

// ---- 2. Saving ----
const good = {
  sections: { water_yard: 'Four sprinkler zones, timer in the garage.\nWater shutoff by the front hose bib.', power_gas: 'Breaker 12 runs the garage', bogus: 'dropped', next_owner_notes: 'The back door sticks in winter.' },
  appliances: [{ item: 'Dishwasher', brand: 'Bosch', year: 2021, manual: 'Kitchen drawer', serial: 'X1' }, { item: '', brand: '', year: '', manual: '' }],
  photoIds: [31, 33, 39, 31], moveOut: ['mail_forwarding', 'bogus', 'utilities'], printAddress: true, secret: 'nope',
};
r = await call(api.onRequestPut, 'PUT', 1, P10, good);
check('the owner saves (200, updatedAt, private no-store)', r.status === 200 && r.json.ok === true && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r.json.updatedAt) && noStore(r), r.text);
const stored = JSON.parse(one('SELECT binder_json AS j FROM pre_listings WHERE id = 10').j);
check('unknown keys are dropped (top level, sections, appliance rows)', !('secret' in stored) && !('bogus' in stored.sections) && !('serial' in stored.appliances[0]) && Object.keys(stored).sort().join() === 'appliances,moveOut,photoIds,printAddress,sections', JSON.stringify(stored));
check('an empty appliance row is dropped', stored.appliances.length === 1 && stored.appliances[0].year === 2021);
check("another home's photo is dropped, and repeats go once", stored.photoIds.join() === '31,33', stored.photoIds.join());
check('only known move-out items are kept', stored.moveOut.join() === 'mail_forwarding,utilities');
check('"Breaker 12 runs the garage" is fine (not a code)', stored.sections.power_gas === 'Breaker 12 runs the garage');
for (const [label, body] of [
  ['"gate code: 4821"', { sections: { trash: 'Side gate code: 4821' } }],
  ['"alarm 1234"', { sections: { next_owner_notes: 'The alarm 1234 is by the door' } }],
  ['"Lockbox #5555" in an appliance row', { appliances: [{ item: 'Key safe', manual: 'Lockbox #5555' }] }],
  ['a passcode in the HOA notes', { sections: { hoa_amenities: 'Pool passcode is 9911' } }],
]) {
  r = await call(api.onRequestPut, 'PUT', 1, P10, body);
  check(`400 CODE_ERROR for ${label}`, r.status === 400 && r.json.error === CODE_ERROR, r.text);
}
check("CODE_ERROR is the shared wording", CODE_ERROR === 'Hand codes over in person instead of writing them here.');
for (const [label, body] of [
  ['a section over 500 characters', { sections: { trash: 'x'.repeat(501) } }],
  ['an appliance name over 60', { appliances: [{ item: 'x'.repeat(61) }] }],
  ['a brand over 40', { appliances: [{ item: 'Oven', brand: 'x'.repeat(41) }] }],
  ['a manual note over 80', { appliances: [{ item: 'Oven', manual: 'x'.repeat(81) }] }],
  ['a year before 1950', { appliances: [{ item: 'Oven', year: 1949 }] }],
  ['a year in the future', { appliances: [{ item: 'Oven', year: new Date().getUTCFullYear() + 1 }] }],
  ['21 appliances', { appliances: Array.from({ length: 21 }, (_, i) => ({ item: `Item ${i}` })) }],
  ['a binder over 16 KB', { sections: Object.fromEntries(Object.keys(lib.BINDER_SECTIONS).map(k => [k, '\u0001'.repeat(500)])) }],
  ['a binder that isn\'t an object', [1, 2]],
]) {
  r = await call(api.onRequestPut, 'PUT', 1, P10, body);
  check(`400 for ${label}`, r.status === 400, r.text);
}
check('500 characters exactly is fine', !lib.validateBinder({ sections: { trash: 'x'.repeat(500) } }, []).error);
check('20 appliances is fine', !lib.validateBinder({ appliances: Array.from({ length: 20 }, (_, i) => ({ item: `Item ${i}` })) }, []).error);
check('more than 8 photos is refused', /up to 8/.test(lib.validateBinder({ photoIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, [1, 2, 3, 4, 5, 6, 7, 8, 9]).error || ''));
check('printAddress defaults to true', lib.validateBinder({}, []).data.printAddress === true && lib.validateBinder({ printAddress: false }, []).data.printAddress === false);
check('the binder can be saved in any status (awarded here) and is stored for the owner only', one('SELECT binder_updated_at AS t FROM pre_listings WHERE id = 10').t !== null);

// ---- 3. The print page ----
r = await call(page.onRequestGet, 'GET', 1, P10);
const html = r.text;
check('print page: 200, HTML, private no-store, CSP from withSecurityHeaders', r.status === 200 && /text\/html/.test(r.headers.get('Content-Type')) && noStore(r) && /default-src 'self'/.test(r.headers.get('Content-Security-Policy') || ''));
check('print page: title and heading', html.includes('<title>Handoff binder: Townhouse in Chula Vista</title>') && html.includes('<h1>Handoff binder: Townhouse in Chula Vista</h1>'));
check('print page: both banners, exact', html.includes(`<p class="binder-banner">${esc(lib.BINDER_NOT_DISCLOSURE)}</p>`) && html.includes(`<p class="binder-banner">${esc(lib.BINDER_CODES_NOTE)}</p>`)
  && lib.BINDER_NOT_DISCLOSURE === 'Owner notes, not a disclosure. Your seller disclosures (like the TDS and SPQ) are separate, and your agent handles those.'
  && lib.BINDER_CODES_NOTE === "Hand over gate, alarm, garage and lockbox codes in person. Don't write them here.");
check('print page: footer lines', html.includes('<p>Prepared by the homeowner on Amico Haus. Owner notes, not a disclosure.</p>') && html.includes('Amico Haus is presented by Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West'));
check('print page: the "Print Binder" button', html.includes('🖨️ Print Binder') && !html.includes('Print Flyer'));
check('print page: the street address when printAddress is on', html.includes('1218 La Vida Ct'));
check('print page: non-empty sections only, lines as paragraphs', html.includes('<h2>Water and yard</h2><p>Four sprinkler zones, timer in the garage.</p><p>Water shutoff by the front hose bib.</p>') && !html.includes('<h2>Trash and recycling</h2>') && html.includes('<h2>Notes for the next owner</h2>'));
check('print page: the appliance table', html.includes('<td>Dishwasher</td><td>Bosch</td><td>2021</td><td>Kitchen drawer</td>'));
check('print page: the chosen photos only', html.includes('/api/pre-listing-photos/31') && html.includes('/api/pre-listing-photos/33') && !html.includes('/api/pre-listing-photos/32') && !html.includes('/api/pre-listing-photos/39'));
check("print page: the move-out list with the owner's ticks and the plain USPS/DMV links", html.includes('☑ Forward your mail with USPS (https://www.usps.com/manage/forward.htm)') && html.includes('☐ Update your address with the DMV (https://www.dmv.ca.gov/)') && html.includes('☑ Set up or stop electric'));
check('print page: noindex', /<meta name="robots" content="noindex/.test(html));
check('print page: no inline style, no on*= handler, no inline script body', !/\sstyle\s*=/.test(html) && !/\son[a-z]+\s*=\s*["']/i.test(html)
  && [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].every(m => /\bsrc=/.test(m[1]) && !m[2].trim()));
const leak = html.match(/.{0,30}(commission|2\.5 ?%|proposal|price opinion|Feels high|750,000|\$).{0,30}/i);
check('print page: nothing from proposals, opinions or visit feedback', !leak, leak && leak[0]);
check('print page: no McKelvey/Patti/Jeff', !/McKelvey|Patti|Jeff/.test(html + read('functions/pre-listing/[id]/binder.js') + read('functions/_lib/handoffBinder.js') + read('handoff-binder.js')));
r = await call(api.onRequestPut, 'PUT', 1, P10, { ...good, printAddress: false });
r = await call(page.onRequestGet, 'GET', 1, P10);
check('print page: no street address or ZIP when printAddress is off', r.status === 200 && !r.text.includes('1218 La Vida Ct') && !r.text.includes('91913'));
check('flyers still say "Print Flyer"', renderFlyerShell('x', '<p>y</p>').includes('🖨️ Print Flyer') && !renderFlyerShell('x', '<p>y</p>').includes('Print Binder'));
check('the flyer route still calls the shell with its default label', !/printLabel/.test(read('functions/listing/[id]/flyer.js')));

// A photo that was picked is replaced (new id) or deleted: it drops out of the binder and the print page.
run('DELETE FROM pre_listing_photos WHERE id = 31');
run("INSERT INTO pre_listing_photos (id, pre_listing_id, r2_key, content_type, position) VALUES (34, 10, 'k34', 'image/jpeg', 0)");
r = await call(api.onRequestGet, 'GET', 1, P10);
check('a replaced/deleted photo drops out of the binder (and the picker shows the new one)', r.json.binder.photoIds.join() === '33' && r.json.photoIds.includes(34) && !r.json.photoIds.includes(31), r.text);
r = await call(page.onRequestGet, 'GET', 1, P10);
check('...and the print page never asks for the missing photo', !r.text.includes('/api/pre-listing-photos/31') && r.text.includes('/api/pre-listing-photos/33'));

// ---- 4. Where the binder never goes, and where it does ----
r = await call(detail.onRequestGet, 'GET', 1, P10);
check('the detail GET never carries the binder (owner included: it loads on its own)', r.status === 200 && !/binder/i.test(r.text), r.text.match(/.{40}binder.{40}/i));
r = await call(detail.onRequestGet, 'GET', 2, P10);
check('...nor for the hired agent', r.status === 200 && !/binder/i.test(r.text));
const adminFiles = [];
const walk = (dir) => { for (const f of readdirSync(`${root}/${dir}`)) { const p = `${dir}/${f}`; if (statSync(`${root}/${p}`).isDirectory()) walk(p); else if (p.endsWith('.js')) adminFiles.push(p); } };
walk('functions/api/admin');
check('no admin route reads binder_json (or SELECT * on pre_listings)', adminFiles.length > 0 && !adminFiles.some(f => /binder|SELECT\s+\*\s+FROM\s+pre_listings|pre_listings\.\*/i.test(read(f))), adminFiles.find(f => /binder|SELECT\s+\*\s+FROM\s+pre_listings|pre_listings\.\*/i.test(read(f))));
check("the detail route source never names binder_json", !/binder/.test(read('functions/api/pre-listings/[id].js')));
r = await call(exportApi.onRequestGet, 'GET', 1, {});
const pls = (r.json && (r.json.preListings || (r.json.data && r.json.data.preListings))) || [];
const exported = pls.find(p => p.id === 10);
check("the owner's export includes the binder (preListings SELECT *)", exported && typeof exported.binder_json === 'string' && JSON.parse(exported.binder_json).sections.water_yard.startsWith('Four sprinkler'), r.text.slice(0, 200));
r = await call(exportApi.onRequestGet, 'GET', 2, {});
check("the hired agent's export never has the owner's binder", !/Four sprinkler/.test(r.text));
run("UPDATE pre_listings SET binder_json = '{\"sections\":{\"trash\":\"Tuesday\"}}' WHERE id = 20");
run('DELETE FROM pre_listings WHERE id = 20');
check('deleting a pre-listing deletes its binder (it lives on the row)', !one('SELECT 1 AS y FROM pre_listings WHERE id = 20'));
run('DELETE FROM users WHERE id = 1');
check("deleting the owner's account deletes the home and its binder (cascade)", !one('SELECT 1 AS y FROM pre_listings WHERE id = 10'));

// ---- 5. The client panel (stubbed browser) ----
const noop = () => {};
const elStub = () => ({ classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop, style: {}, dataset: {} });
const sandbox = {
  console, URLSearchParams, setTimeout, clearTimeout, atob, btoa, Notification: {}, navigator: { userAgent: 'node' },
  window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
  document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: elStub, body: elStub(), readyState: 'complete', documentElement: elStub(), referrer: '' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
for (const f of ['client.js', 'handoff-binder.js']) vm.runInContext(read(f), sandbox, { filename: f });
const panel = vm.runInContext(`binderView.preListingId = 10; binderView.photoIds = [31, 33]; binderView.binder = ${JSON.stringify({
  sections: { water_yard: 'Zones', power_gas: '', paint_finishes: '', trash: '', hoa_amenities: '', next_owner_notes: '' },
  appliances: [{ item: 'Dishwasher', brand: 'Bosch', year: 2021, manual: 'Drawer' }], photoIds: [33], moveOut: ['utilities'], printAddress: false })}; binderPanelHtml()`, sandbox);
check('panel: heading, intro and both banners', panel.includes('<h3>Handoff binder</h3>') && panel.includes('A house manual for the next owner: sprinklers, breakers, paint colors, appliances, trash day and how the HOA amenities work. Only you see it. Print it or save it as a PDF and hand it over at closing.')
  && panel.includes(esc(lib.BINDER_NOT_DISCLOSURE)) && panel.includes(esc(lib.BINDER_CODES_NOTE)));
check('panel: one textarea per section (ids binder_<key>) with the codes hint under every one', Object.keys(lib.BINDER_SECTIONS).every(k => panel.includes(`<label for="binder_${k}">`) && panel.includes(`id="binder_${k}"`))
  && (panel.match(new RegExp(esc(lib.BINDER_CODES_NOTE).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 7 && panel.includes('About the house, not the neighbors.'));
check('panel: placeholders from the spec', panel.includes('placeholder="Sprinkler zones and timer, hose bibs, where the water shutoff is"') && panel.includes('placeholder="How the pool, gym or clubhouse access works (no codes), and how to reach the HOA"'));
check('panel: every label is tied to a field', [...panel.matchAll(/<label\b([^>]*)>/g)].every(m => /\bfor="[^"]+"/.test(m[1])) && [...panel.matchAll(/<label\b[^>]*for="([^"]+)"/g)].every(m => panel.includes(`id="${m[1]}"`)));
check('panel: appliance, photo and move-out fields with the spec ids', panel.includes('id="binderApplianceItem-0"') && panel.includes('value="Bosch"') && panel.includes('id="binderPhoto-33" data-binder-photo="33" checked') && panel.includes('id="binderPhoto-31" data-binder-photo="31">')
  && panel.includes('id="binderMoveOut-utilities" data-binder-move="utilities" checked') && panel.includes('id="binderPrintAddress">'));
check('panel: Save and the printable link', panel.includes('data-binder-action="save">Save binder</button>') && panel.includes('<a class="btn btn-ghost btn-sm" href="/pre-listing/10/binder" target="_blank" rel="noopener">Open printable binder</a>'));
check('panel: the move-out links are only USPS and the DMV', [...panel.matchAll(/href="(https?:[^"]+)"/g)].map(m => m[1]).sort().join() === 'https://www.dmv.ca.gov/,https://www.usps.com/manage/forward.htm');
check('panel labels match the server lists', Object.entries(lib.MOVE_OUT_ITEMS).every(([k, v]) => panel.includes(`data-binder-move="${k}"`) && panel.includes(esc(v))) && Object.values(lib.BINDER_SECTIONS).every(v => panel.includes(esc(v))));
const clientSrc = read('handoff-binder.js');
check('handoff-binder.js: no inline style or handler', !/\sstyle\s*=/.test(clientSrc) && !/\son[a-z]+\s*=\s*["'`]/i.test(clientSrc));
const tops = [...clientSrc.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1] || m[2]);
check('handoff-binder.js: every top-level name is loadHandoffBinderInto or starts with binder/BINDER_', tops.every(nm => nm === 'loadHandoffBinderInto' || /^(binder|BINDER_)/.test(nm)), tops.join());

console.log = realLog;
console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
