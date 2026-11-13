// Nuanced ideas batch, the land-ideas role: Easement Ideas (idea outlines, the builder's wording, the attorney packet),
// Open For (flags and search), the idea cards, the Ideas tab script (ideas.js) and the Terms / Privacy / What's New /
// llms.txt copy. Runs the real handlers against an in-memory SQLite stand-in for D1 that counts statements. No network.
// What it guards: every route is refused while its tool is dark; the site lists options and never recommends one;
// nothing here is or looks like a legal document; one owner to one buyer or user, free, no yields; fair-housing text
// checks; no price, term or "what it pays" on Open For; the packet is owner-only, never cached, never indexed.
// Usage: node --disable-warning=ExperimentalWarning tools/land-ideas-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const read = (f) => readFileSync(`${root}/${f}`, 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec(read('schema.sql'));
// D1 stand-in that counts every statement (used.n).
const used = { n: 0 };
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { used.n++; return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { used.n++; return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { used.n++; const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
};
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0, passed = 0;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + String(detail).slice(0, 700)}`); };
const DARK = { DB };                              // the shipped gate: these tools are admin-only
const LIVE = { DB, NUANCED_ALL_LIVE: '1' };       // the test flag: everything on
const seen = [];                                  // every response body, for the wording scans at the end
const call = async (handler, method, path, who, { params = {}, body, env = LIVE } = {}) => {
  const request = new Request(`https://amicohaus.com${path}`, {
    method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  used.n = 0;
  const res = await handler({ request, env, params, waitUntil() {} });
  const text = await res.text();
  seen.push(text);
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, headers: res.headers, json, text, statements: used.n };
};
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const noStore = (r) => r.headers.get('Cache-Control') === 'private, no-store';

// People: 1 owner A, 2 owner B, 3 a plain member, 4 a member who blocked owner A, 5 an admin, 6 a suspended owner,
// 7 a seeded demo owner, 8 a demo viewer.
const person = (id, { role = 'user', status = 'active', email = `u${id}@example.test` } = {}) => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, email, `User ${id}`, role, status);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
person(1); person(2); person(3); person(4); person(5, { role: 'admin' }); person(6);
person(7, { email: 'seed7@demo.amicohaus.local' }); person(8, { email: 'seed8@demo.amicohaus.local' });
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (4, 1)');
for (const z of ['91915', '91902', '91913']) run('INSERT INTO zip_codes (zip, lat, lng) VALUES (?, 32.6, -117.0)', z);

const it = await mod('functions/_lib/ideaText.js');
const lib = await mod('functions/_lib/dealOutlines.js');
const of = await mod('functions/_lib/openFor.js');
const cardsLib = await mod('functions/_lib/ideaCards.js');
const outlinesApi = await mod('functions/api/deal-outlines/index.js');
const outlineApi = await mod('functions/api/deal-outlines/[id].js');
const openForApi = await mod('functions/api/open-for/index.js');
const openForOneApi = await mod('functions/api/open-for/[id].js');
const cardsApi = await mod('functions/api/idea-cards.js');
const packet = await mod('functions/idea-outline/[id].js');
const gate = await mod('functions/_lib/nuancedGate.js');

const RV = { kind: 'space', useKey: 'rv_boat', useNote: 'For a trailer up to 30 feet', areaNote: 'RV pad along the east fence, about 12 by 40 feet', sketch: { cells: [5, 4, 4, 200, 'x', 17], house: [17, 60, 61], street: 'bottom' }, ask: { amount: 150, per: 'month' }, questions: ['lender', 'hoa', 'nope'], ownQuestion: 'Can my neighbor live there later?', zip: '91915', city: 'Chula Vista', state: 'CA' };

// ================= 1. The launch gate =================
check('the shipped gate: easementIdeas and openFor are dark, sellAndStay and watchAreas are live', gate.NUANCED_TOOLS.easementIdeas === false && gate.NUANCED_TOOLS.openFor === false && gate.NUANCED_TOOLS.sellAndStay === true && gate.NUANCED_TOOLS.watchAreas === true);
const ROUTES = [
  ['GET /api/deal-outlines?mine=1', outlinesApi.onRequestGet, 'GET', '/api/deal-outlines?mine=1', {}],
  ['GET /api/deal-outlines (browse)', outlinesApi.onRequestGet, 'GET', '/api/deal-outlines', {}],
  ['POST /api/deal-outlines', outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', { body: RV }],
  ['GET /api/deal-outlines/:id', outlineApi.onRequestGet, 'GET', '/api/deal-outlines/1', { params: { id: '1' } }],
  ['PUT /api/deal-outlines/:id', outlineApi.onRequestPut, 'PUT', '/api/deal-outlines/1', { params: { id: '1' }, body: { listed: false } }],
  ['DELETE /api/deal-outlines/:id', outlineApi.onRequestDelete, 'DELETE', '/api/deal-outlines/1', { params: { id: '1' } }],
  ['GET /api/open-for?mine=1', openForApi.onRequestGet, 'GET', '/api/open-for?mine=1', {}],
  ['GET /api/open-for?use=', openForApi.onRequestGet, 'GET', '/api/open-for?use=garden', {}],
  ['POST /api/open-for', openForApi.onRequestPost, 'POST', '/api/open-for', { body: { propertyKind: 'home', uses: ['garden'], zip: '91915' } }],
  ['PUT /api/open-for/:id', openForOneApi.onRequestPut, 'PUT', '/api/open-for/1', { params: { id: '1' }, body: { status: 'paused' } }],
  ['DELETE /api/open-for/:id', openForOneApi.onRequestDelete, 'DELETE', '/api/open-for/1', { params: { id: '1' } }],
];
for (const [label, handler, method, path, opts] of ROUTES) {
  const member = await call(handler, method, path, 3, { ...opts, env: DARK });
  const anon = await call(handler, method, path, null, { ...opts, env: DARK });
  check(`dark gate: ${label} -> 404 "Not found." for a member and a signed-out visitor`, member.status === 404 && member.json.error === 'Not found.' && anon.status === 404, `${member.status} ${anon.status}`);
  const anonLive = await call(handler, method, path, null, opts);
  check(`live: ${label} signed out -> 401`, anonLive.status === 401, String(anonLive.status));
}
check('dark gate: nothing was stored by the refused requests', one('SELECT COUNT(*) AS n FROM deal_outlines').n === 0 && one('SELECT COUNT(*) AS n FROM open_for').n === 0);

// ================= 2. validateOutline (the lib) =================
let v = lib.validateOutline({ kind: 'space', useKey: 'garden' });
check('outline: the form starts on month_to_month (space, access) and co_2_4 (co-ownership)', v.data && v.data.termOption === 'month_to_month'
  && lib.validateOutline({ kind: 'access', useKey: 'driveway' }).data.termOption === 'month_to_month' && lib.validateOutline({ kind: 'co_ownership', useKey: 'whole_home' }).data.termOption === 'co_2_4');
check('outline: private by default, no ask, state CA', v.data.listed === 0 && v.data.askAmount === null && v.data.askPer === '' && v.data.state === 'CA');
check('outline: view_sun is parked (refused), unknown kinds and uses are refused', !!lib.validateOutline({ kind: 'view_sun', useKey: 'x' }).error && !!lib.validateOutline({ kind: 'space', useKey: 'driveway' }).error && !!lib.validateOutline({ kind: 'timeshare' }).error);
check('outline: a ladder option of another kind is refused', !!lib.validateOutline({ kind: 'space', useKey: 'garden', termOption: 'co_2_4' }).error && !!lib.validateOutline({ kind: 'co_ownership', useKey: 'whole_home', termOption: 'long_lease' }).error);
check('outline: "Something else" needs the owner\'s words', !!lib.validateOutline({ kind: 'space', useKey: 'other' }).error && !lib.validateOutline({ kind: 'space', useKey: 'other', useNote: 'A kiln shed' }).error);
v = lib.validateOutline(RV);
check('outline: sketch cleaned (unknown values dropped, deduped, sorted, a square in both counts as the idea)', JSON.stringify(v.data.sketch) === '{"cells":[4,5,17],"house":[60,61],"street":"bottom"}', JSON.stringify(v.data && v.data.sketch));
check('outline: questions keep only known keys; the own question may say "live"', JSON.stringify(v.data.questions) === '{"keys":["lender","hoa"],"own":"Can my neighbor live there later?"}', JSON.stringify(v.data && v.data.questions));
const textError = (patch) => lib.validateOutline({ ...RV, ...patch }).error;
check('one buyer, no yield: "investors", "8% return", "passive income", "shares" -> INVEST_ERROR', textError({ useNote: 'Great for investors' }) === it.INVEST_ERROR && textError({ areaNote: '8% return on the pad' }) === it.INVEST_ERROR
  && textError({ useNote: 'Passive income from the pad' }) === it.INVEST_ERROR && textError({ useNote: 'Selling 10 shares of the lot' }) === it.INVEST_ERROR && textError({ ownQuestion: 'Can I offer ownership shares?' }) === it.INVEST_ERROR);
check('"a shared driveway" and "share the garden" are fine', !textError({ useNote: 'A shared driveway' }) && !textError({ areaNote: 'We would share the garden beds' }));
check('fair housing: "Looking for a Christian couple", "No students" -> PERSON_ERROR', textError({ useNote: 'Looking for a Christian couple' }) === it.PERSON_ERROR && textError({ areaNote: 'No students' }) === it.PERSON_ERROR);
check('"someone could live in the RV" -> LIVING_ERROR; "near the school" -> STEERING_ERROR; "1218 La Vida Ct" -> ADDRESS_ERROR', textError({ useNote: 'Someone could live in the RV' }) === it.LIVING_ERROR
  && textError({ areaNote: 'Near the school' }) === (await mod('functions/_lib/homeText.js')).STEERING_ERROR && textError({ areaNote: 'Behind 1218 La Vida Ct' }) === (await mod('functions/_lib/homeText.js')).ADDRESS_ERROR);
check('legal words are refused in the owner\'s text ("This is a binding contract")', textError({ useNote: 'This is a binding contract' }) === it.LEGAL_WORD_ERROR);
check('the city field is a place name only: no address, no sentence, no steering; real cities pass (Temple City too)', [' 1218 La Vida Ct', 'Near the good schools', 'Chula Vista for investors only please now', 'Chula Vista!'].every(c => textError({ city: c }) === lib.CITY_ERROR)
  && ['Chula Vista', 'Bonita', 'Temple City', 'St. Helena', "Coeur d'Alene", 'La Cañada Flintridge', 'Twentynine Palms', ''].every(c => !textError({ city: c }))
  && of.validateOpenFor({ propertyKind: 'home', uses: ['garden'], zip: '91915', city: 'Near the church' }).error === lib.CITY_ERROR);
check('a pool outline with an ask is refused with POOL_LINE; without an ask it saves', lib.validateOutline({ kind: 'space', useKey: 'pool', ask: { amount: 50, per: 'day' } }).error === 'Leave the price out for a pool. ' + lib.POOL_LINE
  && !lib.validateOutline({ kind: 'space', useKey: 'pool' }).error);
check('ask: whole dollars 1 to 50,000,000 with a unit', !!textError({ ask: { amount: 0, per: 'month' } }) && !!textError({ ask: { amount: 12.5, per: 'month' } }) && !!textError({ ask: { amount: 50000001, per: 'year' } })
  && !!textError({ ask: { amount: 100, per: 'week' } }) && !textError({ ask: { amount: 50000000, per: 'once' } }) && lib.validateOutline({ ...RV, ask: { amount: '', per: '' } }).data.askAmount === null);
check('co-ownership: the ask is one time only', !!lib.validateOutline({ kind: 'co_ownership', useKey: 'whole_home', ask: { amount: 400000, per: 'month' } }).error
  && lib.validateOutline({ kind: 'co_ownership', useKey: 'whole_home', ask: { amount: 400000, per: 'once' } }).data.askPer === 'once');
// A lease buyout or a sale of a rent stream is never listed (review fix); nor is the kind of person, in any word order.
const buyout = lib.validateOutline({ kind: 'space', useKey: 'other', useNote: 'Tower lease buyout: take over the rent my cell tower pays', termOption: 'long_lease', ask: { amount: 150000, per: 'once' }, zip: '91915', listed: true, ack: true });
check('a lease buyout can\'t be saved or listed as an outline (INVEST_ERROR)', buyout.error === it.INVEST_ERROR && !buyout.data);
check('buyout and rent-sale wording is refused in outline and Open For text; plain space-and-use text passes',
  ['Tower lease rent for sale, buy the monthly rent', 'Earn money from my lot', 'Selling the rent from my solar lease', 'Buy my lease payments', 'Lease buy-out wanted'].every(s => lib.outlineTextProblem(s) === it.INVEST_ERROR)
  && ['Garage bay near the gate, by the month', 'Space for one boat on a trailer, no overnight stays', 'Shared driveway with the lot next door', 'Room to take over the back corner for a garden'].every(s => lib.outlineTextProblem(s) === null)
  && of.validateOpenFor({ propertyKind: 'home', uses: ['garden'], zip: '91915', facts: { note: 'Tower lease buyout wanted' } }).error === it.INVEST_ERROR);
check('the kind of person is refused in a listed outline and an Open For note, whatever the word order',
  textError({ useNote: 'Women only, local residents preferred', listed: true, ack: true }) === it.PERSON_ERROR && textError({ areaNote: 'Perfect for a family' }) === it.PERSON_ERROR
  && of.validateOpenFor({ propertyKind: 'home', uses: ['garden'], zip: '91915', facts: { note: 'English speakers welcome, seniors preferred' } }).error === it.PERSON_ERROR
  && of.validateOpenFor({ propertyKind: 'home', uses: ['garden'], zip: '91915', facts: { note: 'Veterans welcome' } }).error === it.PERSON_ERROR);
check('listing needs the box ("Tick the box to list your outline.") and a ZIP', textError({ listed: true }) === 'Tick the box to list your outline.' && !!lib.validateOutline({ ...RV, zip: '', listed: true, ack: true }).error
  && lib.validateOutline({ ...RV, listed: true, ack: true }).data.listed === 1);
const coListed = lib.validateOutline({ kind: 'co_ownership', useKey: 'whole_home', zip: '91915', listed: true, ack: true });
check('a co-ownership outline is never listed: listed stays 0 even when asked', coListed.data && coListed.data.listed === 0);
check('co_5_plus and co_time_based say "Not offered here." and "It can\'t be listed."', ['co_5_plus', 'co_time_based'].every(k => lib.TERM_OPTIONS[k].notes.some(n => n.includes('Not offered here.')) && lib.TERM_OPTIONS[k].notes.some(n => n.includes("It can't be listed."))));
check('the written labels, word for word', JSON.stringify(lib.OUTLINE_LABELS) === JSON.stringify(['This is an idea outline. It is not an easement, lease, or contract.', 'Not an easement. A real one is written by an attorney and recorded with the county.', 'Nothing here is binding on you or anyone else.'])
  && lib.SKETCH_LINE === 'Your sketch is a rough picture. It is not a survey.' && lib.ASK_LINE === 'Asking price is your own number. It is not an appraisal.'
  && lib.SKETCH_VIEWER_LINE === "The owner's sketch is a rough picture. It is not a survey." && lib.ASK_VIEWER_LINE === "The ask is the owner's own number. It is not an appraisal."
  && lib.outlineConfig().sketchViewerLine === lib.SKETCH_VIEWER_LINE && lib.outlineConfig().askViewerLine === lib.ASK_VIEWER_LINE
  && lib.NO_RECOMMEND_LINE === "This form starts on the lightest option. Amico Haus doesn't recommend one. A California attorney can tell you which option fits your property."
  && JSON.stringify(lib.LISTING_LINES) === JSON.stringify(['Listing by the owner. Amico Haus does not negotiate or take part in the deal.', 'For one buyer or user. Not an investment offering.'])
  && lib.LIST_ACK === "I understand Amico Haus doesn't negotiate, write documents or take part in any deal, and that this outline isn't an offer."
  && JSON.stringify(lib.PACKET_LINES) === JSON.stringify(['Take your packet to any California attorney you choose.', 'Find a certified lawyer referral service at the State Bar of California.', 'Amico Haus does not write legal documents.'])
  && lib.STATE_BAR_LRS_URL === 'https://www.calbar.ca.gov/public/find-legal-professionals/find-lawyer-referral-service');
check('the ladder: 7 options in the written order; space and access use the first four, co-ownership the last three', JSON.stringify(Object.keys(lib.TERM_OPTIONS)) === JSON.stringify(['month_to_month', 'lease_3yr', 'recorded_easement', 'long_lease', 'co_2_4', 'co_5_plus', 'co_time_based'])
  && JSON.stringify(lib.OUTLINE_KINDS.space.ladder) === JSON.stringify(['month_to_month', 'lease_3yr', 'recorded_easement', 'long_lease']) && JSON.stringify(lib.OUTLINE_KINDS.access.ladder) === JSON.stringify(lib.OUTLINE_KINDS.space.ladder)
  && JSON.stringify(lib.OUTLINE_KINDS.co_ownership.ladder) === JSON.stringify(['co_2_4', 'co_5_plus', 'co_time_based']) && !Object.hasOwn(lib.OUTLINE_KINDS, 'view_sun'));
check('the eight attorney questions', Object.keys(lib.QUESTIONS).length === 8 && lib.QUESTIONS.lender === "Do I need my lender's consent?" && lib.QUESTIONS.survey === 'Do we need a surveyor?');
const sampleLines = lib.outlineLines({ kind: 'space', useKey: 'rv_boat', useNote: '', areaNote: 'East fence', termOption: 'month_to_month', ask: { amount: 1500, per: 'month' }, city: 'Chula Vista', state: 'CA', zip: '91915' });
check('outlineLines: the written shapes', JSON.stringify(sampleLines) === JSON.stringify(['RV or boat parking', 'Where on the lot: East fence', 'Option the owner is looking at: Month-to-month use (this form starts here)', "Owner's ask: $1,500 a month", 'Area: Chula Vista, CA 91915']), JSON.stringify(sampleLines));
const svg = lib.sketchSvg({ cells: [0, 13], house: [143], street: 'left' });
check('sketchSvg: a 240 x 240 picture, 144 squares, classes only, the street side named, no inline style', svg.startsWith('<svg class="sketch-grid" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Owner\'s rough sketch of the lot">')
  && (svg.match(/<rect /g) || []).length === 144 && (svg.match(/class="sk-cell sk-area"/g) || []).length === 2 && (svg.match(/class="sk-cell sk-house"/g) || []).length === 1 && />Street<\/text>/.test(svg) && !/ style=/.test(svg));

// ================= 3. Outline routes =================
let r = await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 1, { body: { ...RV, listed: true, ack: true } });
const rvId = r.json && r.json.id;
check('POST a listed outline: 201, private no-store, 3 statements + session (ZIP, limit, INSERT)', r.status === 201 && noStore(r) && rvId > 0 && r.statements === 4, `${r.status} ${r.statements} ${r.text}`);
r = await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 1, { body: { kind: 'access', useKey: 'driveway' } });
check('POST a private outline with no ZIP: 1 statement + session', r.status === 201 && r.statements === 2, `${r.status} ${r.statements}`);
r = await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 1, { body: { ...RV, zip: '00000' } });
check('POST with a ZIP we don\'t know is refused', r.status === 400 && r.json.error === "We don't know that ZIP code.");
r = await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 1, { body: { ...RV, useNote: 'Tenant wanted for the pad' } });
check('POST with "Tenant wanted" -> 400 LIVING_ERROR', r.status === 400 && r.json.error === it.LIVING_ERROR);
r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines?mine=1', 1);
check('GET mine: both outlines, the builder config, 1 statement + session, private no-store', r.status === 200 && noStore(r) && r.json.outlines.length === 2 && r.json.config.kinds.length === 3 && r.statements === 2, `${r.statements}`);
const mineRv = r.json.outlines.find(o => o.id === rvId);
check('GET mine: my questions and listed flag ride along; no address or parcel field anywhere', mineRv.listed === true && JSON.stringify(mineRv.questions) === '["lender","hoa"]' && mineRv.ownQuestion === 'Can my neighbor live there later?' && !/address|apn|parcel/i.test(JSON.stringify(r.json.outlines)));
check('config: every option carries its notes, and the HOA-and-city line is sent with it', r.json.config.kinds.every(k => k.ladder.every(o => o.notes.length >= 2)) && r.json.config.hoaCityLine === it.HOA_CITY_LINE && r.json.config.noRecommendLine === lib.NO_RECOMMEND_LINE);

r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines', 2);
check('browse: another member sees the listed outline only (not the private one), 1 statement + session', r.status === 200 && noStore(r) && r.json.outlines.length === 1 && r.json.outlines[0].id === rvId && r.statements === 2, JSON.stringify(r.json).slice(0, 200));
const card = r.json.outlines[0];
check('browse card: the written fields, the owner for Messages, and never the owner\'s attorney questions', JSON.stringify(Object.keys(card).sort()) === JSON.stringify(['areaNote', 'ask', 'city', 'id', 'kind', 'lines', 'owner', 'sketch', 'state', 'termOption', 'useKey', 'useLabel', 'useNote', 'zip'])
  && JSON.stringify(card.owner) === '{"id":1,"name":"User 1"}' && JSON.stringify(card.ask) === '{"amount":150,"per":"month"}' && !/lender|neighbor live/i.test(JSON.stringify(card)), JSON.stringify(Object.keys(card).sort()));
r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines', 1);
check('browse never shows my own outlines', r.json.outlines.length === 0);
r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines', 4);
check('browse hides a blocked pair (either way) from each other', r.json.outlines.length === 0);
r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines?zip=91902', 2);
const byZip = r.json.outlines.length;
r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines?zip=91915&use=rv_boat', 2);
check('browse filters: ZIP is exact, use is exact', byZip === 0 && r.json.outlines.length === 1 && (await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines?use=garden', 2)).json.outlines.length === 0);
check('browse: a bad ZIP or an unknown use is a 400', (await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines?zip=9191', 2)).status === 400 && (await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines?use=whatever', 2)).status === 400);
// Suspended and demo owners.
run("INSERT INTO deal_outlines (id, user_id, kind, use_key, zip, listed) VALUES (901, 6, 'space', 'garden', '91915', 1)");
run("INSERT INTO deal_outlines (id, user_id, kind, use_key, zip, listed) VALUES (902, 7, 'space', 'storage', '91915', 1)");
run("UPDATE users SET status = 'suspended' WHERE id = 6");
r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines', 2);
check('browse leaves out a suspended owner and a demo owner', JSON.stringify(r.json.outlines.map(o => o.id)) === JSON.stringify([rvId]), JSON.stringify(r.json.outlines.map(o => o.id)));
r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines', 8);
check('a demo viewer also sees the demo owner\'s outline', r.json.outlines.some(o => o.id === 902) && !r.json.outlines.some(o => o.id === 901));

r = await call(outlineApi.onRequestGet, 'GET', `/api/deal-outlines/${rvId}`, 2, { params: { id: String(rvId) } });
check('GET one: a member opens a listed outline (browse card shape), 1 statement + session', r.status === 200 && r.json.outline.owner.id === 1 && r.json.outline.questions === undefined && r.statements === 2);
r = await call(outlineApi.onRequestGet, 'GET', `/api/deal-outlines/${rvId}`, 1, { params: { id: String(rvId) } });
check('GET one: the owner gets their own copy', r.status === 200 && r.json.outline.listed === true && Array.isArray(r.json.outline.questions));
check('GET one: a blocked member, a suspended owner\'s outline and a bad id are the same 404', (await call(outlineApi.onRequestGet, 'GET', '/x', 4, { params: { id: String(rvId) } })).status === 404
  && (await call(outlineApi.onRequestGet, 'GET', '/x', 2, { params: { id: '901' } })).status === 404 && (await call(outlineApi.onRequestGet, 'GET', '/x', 2, { params: { id: 'abc' } })).status === 404);
const privateId = one("SELECT id FROM deal_outlines WHERE user_id = 1 AND listed = 0").id;
check('GET one: a private outline is a 404 for anyone else', (await call(outlineApi.onRequestGet, 'GET', '/x', 2, { params: { id: String(privateId) } })).status === 404);

r = await call(outlineApi.onRequestPut, 'PUT', '/x', 2, { params: { id: String(rvId) }, body: { listed: false } });
check('PUT by someone else -> 404, nothing changed', r.status === 404 && one('SELECT listed FROM deal_outlines WHERE id = ?', rvId).listed === 1);
r = await call(outlineApi.onRequestPut, 'PUT', '/x', 1, { params: { id: String(rvId) }, body: { listed: false } });
check('PUT { listed: false } alone stops listing and keeps the rest; 2 statements + session', r.status === 200 && noStore(r) && r.statements === 3 && JSON.stringify(one('SELECT listed, use_note, ask_amount, zip FROM deal_outlines WHERE id = ?', rvId)) === '{"listed":0,"use_note":"For a trailer up to 30 feet","ask_amount":150,"zip":"91915"}', `${r.status} ${r.statements}`);
r = await call(outlineApi.onRequestPut, 'PUT', '/x', 1, { params: { id: String(rvId) }, body: { listed: true } });
check('PUT listing again without the box is refused', r.status === 400 && r.json.error === 'Tick the box to list your outline.');
r = await call(outlineApi.onRequestPut, 'PUT', '/x', 1, { params: { id: String(rvId) }, body: { listed: true, ack: true, zip: '91902' } });
check('PUT list + a new ZIP: 4 statements + session (row, ZIP, limit, UPDATE)', r.status === 200 && r.statements === 5 && one('SELECT listed, zip FROM deal_outlines WHERE id = ?', rvId).zip === '91902', `${r.status} ${r.statements}`);
check('a listed save counts toward idea_post (2 so far)', one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 1 AND kind = 'idea_post'").n === 2);
// Limits: 5 outlines, 3 listed.
for (const useKey of ['garden', 'storage']) await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 1, { body: { kind: 'space', useKey, zip: '91915', listed: true, ack: true } });
r = await call(outlineApi.onRequestPut, 'PUT', '/x', 1, { params: { id: String(privateId) }, body: { zip: '91915', listed: true, ack: true } });
check('a 4th listed outline is refused (edit path)', r.status === 400 && r.json.error === lib.LISTED_LIMIT_ERROR && one('SELECT COUNT(*) AS n FROM deal_outlines WHERE user_id = 1 AND listed = 1').n === 3, r.text);
r = await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 1, { body: { kind: 'space', useKey: 'workshop', zip: '91915', listed: true, ack: true } });
check('a 4th listed outline is refused (create path)', r.status === 400 && r.json.error === lib.LISTED_LIMIT_ERROR, r.text);
r = await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 1, { body: { kind: 'co_ownership', useKey: 'whole_home', zip: '91915', listed: true, ack: true } });
check('a co-ownership outline saves, unlisted even when asked (the 5th outline)', r.status === 201 && one('SELECT listed FROM deal_outlines WHERE id = ?', r.json.id).listed === 0 && one('SELECT COUNT(*) AS n FROM deal_outlines WHERE user_id = 1').n === 5);
const coId = r.json.id;
r = await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 1, { body: { kind: 'space', useKey: 'court' } });
check('a 6th outline is refused: "You can keep up to 5 idea outlines."', r.status === 400 && r.json.error === 'You can keep up to 5 idea outlines.');
r = await call(outlineApi.onRequestDelete, 'DELETE', '/x', 2, { params: { id: String(coId) } });
const stillThere = one('SELECT COUNT(*) AS n FROM deal_outlines WHERE id = ?', coId).n;
r = await call(outlineApi.onRequestDelete, 'DELETE', '/x', 1, { params: { id: String(coId) } });
check('DELETE: only the owner; 1 statement + session', stillThere === 1 && r.status === 200 && r.statements === 2 && one('SELECT COUNT(*) AS n FROM deal_outlines WHERE id = ?', coId).n === 0);
check('the tables hold no address, parcel, fee or payment column', ['deal_outlines', 'open_for'].every(t => !sqlite.prepare(`PRAGMA table_info(${t})`).all().some(c => /address|apn|parcel|fee|payment|price|rent|term_months/i.test(c.name))));

// Admin with the gate dark: the tool works; what the admin lists is still hidden from members (their gate is dark).
r = await call(outlinesApi.onRequestPost, 'POST', '/api/deal-outlines', 5, { body: { ...RV, listed: true, ack: true }, env: DARK });
check('dark gate: an admin can save and list an outline', r.status === 201);
r = await call(outlinesApi.onRequestGet, 'GET', '/api/deal-outlines?mine=1', 5, { env: DARK });
check('dark gate: an admin reads their outlines', r.status === 200 && r.json.outlines.length === 1);
run('DELETE FROM deal_outlines WHERE user_id = 5');

// ================= 4. The attorney packet =================
r = await call(packet.onRequestGet, 'GET', `/idea-outline/${rvId}`, 1, { params: { id: String(rvId) } });
const page = r.text;
const body = page.slice(page.indexOf('<div class="packet">'), page.indexOf('</main>'));
check('packet: the owner gets 200, private no-store, noindex (header and meta), security headers, 2 statements', r.status === 200 && noStore(r) && r.headers.get('X-Robots-Tag') === 'noindex' && page.includes('<meta name="robots" content="noindex">')
  && !!r.headers.get('Content-Security-Policy') && r.statements === 2, `${r.status} ${r.statements} ${r.headers.get('Cache-Control')}`);
const esc = (await mod('functions/_lib/util.js')).escapeHtml;
check('packet: the h1, the three labels, the sketch line, the ask line, the three packet lines', body.includes('<h1>Idea outline for my attorney</h1>') && lib.OUTLINE_LABELS.every(l => body.includes(esc(l))) && body.includes(esc(lib.SKETCH_LINE))
  && body.includes(esc(lib.ASK_LINE)) && lib.PACKET_LINES.every(l => body.includes(esc(l))));
check('packet: the option with its notes, the HOA-and-city line, then the no-recommend line', body.includes("<h2>The option I'm looking at</h2>") && lib.TERM_OPTIONS.month_to_month.notes.every(n => body.includes(esc(n)))
  && body.indexOf(esc(it.HOA_CITY_LINE)) > body.indexOf(esc(lib.TERM_OPTIONS.month_to_month.notes[2])) && body.indexOf(esc(lib.NO_RECOMMEND_LINE)) > body.indexOf(esc(it.HOA_CITY_LINE)));
check('packet: the who-to-ask checklist (7, unticked) and my questions', body.includes('<h2>Who to ask before anything is signed</h2>') && lib.WHO_TO_ASK.length === 7 && lib.WHO_TO_ASK.every(w => body.includes(esc(w)))
  && (body.match(/<input type="checkbox"/g) || []).length === 7 && !/checked/.test(body) && body.includes('<h2>My questions</h2>') && body.includes(esc("Do I need my lender's consent?")) && body.includes('Can my neighbor live there later?'));
const fillIns = body.match(/<input type="text"[^>]*>/g) || [];
check('packet: the two fill-in lines have no name, sit in no form, and say they aren\'t kept', fillIns.length === 2 && fillIns.every(i => !/\sname=/.test(i) && /autocomplete="off"/.test(i)) && !/<form/i.test(body)
  && body.includes('Parcel number (APN)') && body.includes('Property address') && body.includes("Type these in before you print. Amico Haus doesn't keep them."));
const outbound = body.match(/href="https?:[^"]*"/g) || [];
check('packet: exactly one outbound link, the State Bar referral page', outbound.length === 1 && outbound[0] === `href="${lib.STATE_BAR_LRS_URL}"` && body.includes('rel="noopener noreferrer"'), outbound.join(' '));
check('packet: names no attorney, firm, surveyor or title company; has no "talk to Rudy" button', !/attorney at law|esq\.|law (firm|office)/i.test(body) && !/talk to rudy|contact rudy|tel:/i.test(body));
check('packet: a Print button (client.js handles data-action="print"), and no script of its own', /<button type="button" class="btn btn-primary" data-action="print">Print<\/button>/.test(body) && /\[data-action="print"\]/.test(read('client.js'))
  && !/<script(?![^>]*src=)/.test(page) && !/ style=| on[a-z]+=/.test(body));
check('packet: every label has for=', (body.match(/<label\b[^>]*>/g) || []).every(l => /\sfor="/.test(l)));
for (const [label, who, env, id] of [['another member', 2, LIVE, rvId], ['a signed-out visitor', null, LIVE, rvId], ['the owner while the tool is dark', 1, DARK, rvId], ['a bad id', 1, LIVE, 'abc'], ['a missing id', 1, LIVE, 999999]]) {
  const res = await call(packet.onRequestGet, 'GET', `/idea-outline/${id}`, who, { params: { id: String(id) }, env });
  check(`packet: ${label} -> the 404 page (private no-store, noindex), with nothing from the outline`, res.status === 404 && noStore(res) && res.headers.get('X-Robots-Tag') === 'noindex' && !res.text.includes('Idea outline for my attorney') && !res.text.includes('east fence'), `${res.status}`);
}
r = await call(packet.onRequestGet, 'GET', '/x', 5, { params: { id: String(rvId) }, env: DARK });
check('packet: an admin can\'t open someone else\'s packet either', r.status === 404);

// ================= 5. Open For =================
const FLAGS = { propertyKind: 'rural_land', uses: ['hunting', 'grazing', 'antenna', 'filming', 'nope'], longAck: true, zip: '91915', city: 'Chula Vista', state: 'ca', facts: { lotSize: '5_to_20', hoa: 'no', roadAccess: 'dirt', fenced: 'yes', water: 'sometimes', roof: 'metal', mortgage: 'yes', note: 'Flat ground near the gate' } };
v = of.validateOpenFor(FLAGS);
check('open for: known uses for the kind kept, unknown facts and values dropped, the long-lease tick stored', v.data && JSON.stringify(v.data.uses) === '["hunting","grazing","antenna","filming"]'
  && JSON.stringify(v.data.facts) === '{"lotSize":"5_to_20","hoa":"no","roadAccess":"dirt","fenced":"yes","roof":"metal","note":"Flat ground near the gate","longAck":true}' && v.data.state === 'CA', JSON.stringify(v));
check('open for: hunting, recreation and grazing on a home are dropped', JSON.stringify(of.validateOpenFor({ propertyKind: 'home', uses: ['hunting', 'recreation', 'grazing', 'garden'], zip: '91915' }).data.uses) === '["garden"]'
  && of.validateOpenFor({ propertyKind: 'home', uses: ['hunting'], zip: '91915' }).error === 'Pick at least one use.');
check('open for: a long use without the box is refused', of.validateOpenFor({ ...FLAGS, longAck: false }).error === 'Tick the box to confirm you read the notes for long leases.' && of.validateOpenFor({ propertyKind: 'home', uses: ['sign'], zip: '91915' }).error === of.LONG_ACK_ERROR);
check('open for: the note runs the text checks; a ZIP is needed', of.validateOpenFor({ ...FLAGS, facts: { note: 'Great passive income for an investor' } }).error === it.INVEST_ERROR && of.validateOpenFor({ ...FLAGS, facts: { note: 'A tenant could move in' } }).error === it.LIVING_ERROR
  && !!of.validateOpenFor({ ...FLAGS, zip: '' }).error);
// No price and no term: the note can't carry them either (Rudy 11.13: Open For stores no price or term).
check('open for: a note with a price, what a use pays or a lease length is refused; sizes pass',
  ['Pays $400 per month', '$500 a day for film shoots', '5 year lease, renewable', 'Rent of 300 monthly', 'Asking 2k/month', 'A tower company offered 1200 a month', 'No fee for neighbors', '30 days notice']
    .every(note => of.validateOpenFor({ ...FLAGS, facts: { note } }).error === of.OPEN_FOR_NOTE_ERROR)
  && ['Flat ground near the gate', 'About 2 acres, 12 by 40 foot pad', 'Sunny side yard with a hose bib', 'Parking for 2 cars'].every(note => !of.validateOpenFor({ ...FLAGS, facts: { note } }).error),
  JSON.stringify(['Pays $400 per month', '30 days notice', 'Parking for 2 cars'].map(note => of.validateOpenFor({ ...FLAGS, facts: { note } }).error)));
check('a pool outline can\'t carry a price in its words either', (lib.validateOutline({ kind: 'space', useKey: 'pool', useNote: 'Swim time, $20 a day' }).error || '').startsWith('Leave the price out for a pool.')
  && !lib.validateOutline({ kind: 'space', useKey: 'pool', useNote: 'Morning laps on weekdays' }).error, JSON.stringify(lib.validateOutline({ kind: 'space', useKey: 'pool', useNote: 'Swim time, $20 a day' })));
check('open for: no price, term, rent or mortgage field exists', !/price|term|rent|pays|mortgage|amount/i.test(Object.keys(of.OPEN_FOR_FACTS).join(' ')) && !Object.keys(v.data).some(k => /price|term|rent|ask|amount/i.test(k)));
check('open for: 13 uses; minerals, oil, gas, wind and storage batteries are not flags', Object.keys(of.OPEN_FOR_USES).length === 13 && !Object.keys(of.OPEN_FOR_USES).some(k => /mineral|oil|gas|wind|battery/i.test(k)));
check('open for: the written lines, word for word', of.OPEN_FOR_LINE === 'Open to hearing offers for this use. Not an offer to lease.' && of.LIGHT_LINE === 'Day use and month-to-month use are permissions, not leases.'
  && of.LONG_LINE === "Antenna, solar and sign deals are long leases. They need an attorney and, if you have a mortgage, your lender's consent." && of.TAX_LINE === 'A lease of 35 years or more, counting renewals, can raise the property tax on the leased part.'
  && of.OPEN_FOR_CITY_LINE === "Check your city's rules and your HOA before any paid use." && of.NO_PAY_LINE === 'Amico Haus never estimates what a use pays.'
  && of.LONG_ACK === "I've read the notes: these are long leases that need an attorney and, if I have a mortgage, my lender's consent.");
check('open for lines: always the first three; a light use adds the permissions line; a long use adds the long-lease and tax lines', JSON.stringify(of.openForLines(['garden'])) === JSON.stringify([of.OPEN_FOR_LINE, of.OPEN_FOR_CITY_LINE, of.NO_PAY_LINE, of.LIGHT_LINE])
  && JSON.stringify(of.openForLines(['antenna'])) === JSON.stringify([of.OPEN_FOR_LINE, of.OPEN_FOR_CITY_LINE, of.NO_PAY_LINE, of.LONG_LINE, of.TAX_LINE]) && of.openForLines(['garden', 'sign']).length === 6);

r = await call(openForApi.onRequestPost, 'POST', '/api/open-for', 1, { body: FLAGS });
const flagId = r.json && r.json.id;
check('POST open-for: 201, private no-store, 3 statements + session (ZIP, limit, INSERT)', r.status === 201 && noStore(r) && r.statements === 4, `${r.status} ${r.statements} ${r.text}`);
r = await call(openForApi.onRequestPost, 'POST', '/api/open-for', 1, { body: { ...FLAGS, zip: '00000' } });
check('POST open-for with a ZIP we don\'t know is refused', r.status === 400 && r.json.error === "We don't know that ZIP code.");
r = await call(openForApi.onRequestGet, 'GET', '/api/open-for?mine=1', 1);
check('GET mine: my flag set + the form config, 1 statement + session', r.status === 200 && noStore(r) && r.json.flags.length === 1 && r.json.flags[0].status === 'active' && r.json.config.uses.length === 13 && r.statements === 2);
r = await call(openForApi.onRequestGet, 'GET', '/api/open-for', 2);
check('search needs a use', r.status === 400 && r.json.error === 'Pick a use to search for.' && (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=minerals', 2)).status === 400);
r = await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting&zip=91915', 2);
check('search by use + ZIP: 1 statement + session, private no-store', r.status === 200 && noStore(r) && r.json.flags.length === 1 && r.statements === 2, r.text.slice(0, 200));
const flag = r.json.flags[0];
check('search card: the written fields, the owner for Messages, never an address, a price or the stored tick', JSON.stringify(Object.keys(flag).sort()) === JSON.stringify(['city', 'factLines', 'facts', 'id', 'lines', 'owner', 'propertyKind', 'propertyKindLabel', 'state', 'useLabels', 'uses', 'zip'])
  && JSON.stringify(flag.owner) === '{"id":1,"name":"User 1"}' && flag.facts.longAck === undefined && !/address|price|\$/i.test(JSON.stringify(flag)), JSON.stringify(Object.keys(flag).sort()));
check('search card lines: OPEN_FOR_LINE, the city line, NO_PAY_LINE, and with a long use LONG_LINE + TAX_LINE', [of.OPEN_FOR_LINE, of.OPEN_FOR_CITY_LINE, of.NO_PAY_LINE, of.LIGHT_LINE, of.LONG_LINE, of.TAX_LINE].every(l => flag.lines.includes(l)));
check('search card: the owner\'s facts are labeled as the owner\'s', flag.factLines.length === 6 && flag.factLines.slice(0, 5).every(l => l.includes('(owner says)')) && flag.factLines[5] === "Owner's note: Flat ground near the gate", JSON.stringify(flag.factLines));
check('search: city equals ignoring case; another use, ZIP or city finds nothing', (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting&city=chula%20vista', 2)).json.flags.length === 1
  && (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting&city=chula', 2)).json.flags.length === 0 && (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=garden&zip=91915', 2)).json.flags.length === 0
  && (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting&zip=91902', 2)).json.flags.length === 0);
check('search SQL: json_each on the uses, never a LIKE on what someone typed', /json_each\(f\.uses_json\) WHERE value = \?4/.test(read('functions/api/open-for/index.js')) && !/LIKE \?[456]/.test(read('functions/api/open-for/index.js')));
run("INSERT INTO open_for (id, user_id, property_kind, zip, uses_json) VALUES (911, 6, 'rural_land', '91915', '[\"hunting\"]')");
run("INSERT INTO open_for (id, user_id, property_kind, zip, uses_json) VALUES (912, 7, 'rural_land', '91915', '[\"hunting\"]')");
r = await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting', 2);
check('search hides suspended and demo owners', JSON.stringify(r.json.flags.map(f => f.id)) === JSON.stringify([flagId]), JSON.stringify(r.json.flags.map(f => f.id)));
check('search hides a blocked pair and my own flag set', (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting', 4)).json.flags.length === 0 && (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting', 1)).json.flags.length === 0);
check('a demo viewer also sees the demo owner\'s flag set', (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting', 8)).json.flags.some(f => f.id === 912));

r = await call(openForOneApi.onRequestPut, 'PUT', '/x', 2, { params: { id: String(flagId) }, body: { status: 'paused' } });
check('PUT open-for by someone else -> 404', r.status === 404);
r = await call(openForOneApi.onRequestPut, 'PUT', '/x', 1, { params: { id: String(flagId) }, body: { status: 'paused' } });
check('PUT { status: paused } alone pauses it and keeps the rest (the stored tick stands); 3 statements + session', r.status === 200 && r.statements === 4 && one('SELECT status, uses_json FROM open_for WHERE id = ?', flagId).status === 'paused'
  && JSON.parse(one('SELECT facts_json FROM open_for WHERE id = ?', flagId).facts_json).longAck === true, `${r.status} ${r.statements} ${r.text}`);
check('a paused flag set is out of search', (await call(openForApi.onRequestGet, 'GET', '/api/open-for?use=hunting', 2)).json.flags.length === 0);
r = await call(openForOneApi.onRequestPut, 'PUT', '/x', 1, { params: { id: String(flagId) }, body: { status: 'active', uses: ['sign', 'garden'] } });
check('PUT with new uses needs the long-lease box again', r.status === 400 && r.json.error === of.LONG_ACK_ERROR);
r = await call(openForOneApi.onRequestPut, 'PUT', '/x', 1, { params: { id: String(flagId) }, body: { status: 'active', uses: ['garden'], zip: '91902' } });
check('PUT with a new ZIP: 4 statements + session; the long tick is gone with the long use', r.status === 200 && r.statements === 5 && one('SELECT zip, uses_json, facts_json FROM open_for WHERE id = ?', flagId).uses_json === '["garden"]'
  && JSON.parse(one('SELECT facts_json FROM open_for WHERE id = ?', flagId).facts_json).longAck === undefined, `${r.status} ${r.statements}`);
for (let i = 0; i < 2; i++) await call(openForApi.onRequestPost, 'POST', '/api/open-for', 1, { body: { propertyKind: 'home', uses: ['garden'], zip: '91915' } });
r = await call(openForApi.onRequestPost, 'POST', '/api/open-for', 1, { body: { propertyKind: 'home', uses: ['garden'], zip: '91915' } });
check('a 4th flag set is refused', r.status === 400 && r.json.error === of.OPEN_FOR_LIMIT_ERROR && one('SELECT COUNT(*) AS n FROM open_for WHERE user_id = 1').n === 3);
check('every Open For save counts toward idea_post', one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 1 AND kind = 'idea_post'").n >= 8);
r = await call(openForOneApi.onRequestDelete, 'DELETE', '/x', 1, { params: { id: String(flagId) } });
check('DELETE open-for: the owner, 1 statement + session', r.status === 200 && r.statements === 2 && (await call(openForOneApi.onRequestDelete, 'DELETE', '/x', 1, { params: { id: String(flagId) } })).status === 404);
r = await call(openForApi.onRequestPost, 'POST', '/api/open-for', 5, { body: { propertyKind: 'home', uses: ['garden'], zip: '91915' }, env: DARK });
check('dark gate: an admin can save Open For flags', r.status === 201);
run('DELETE FROM open_for WHERE user_id = 5');

// Open For wording: nothing about what a use pays (the one allowed sentence is NO_PAY_LINE).
const openForText = JSON.stringify(of.openForConfig()).split(of.NO_PAY_LINE).join('') + JSON.stringify(flag).split(of.NO_PAY_LINE).join('');
check('Open For: no dollar figure, "per month", "pays", "income" or "rent of" anywhere outside NO_PAY_LINE', !/\$\s?\d|per month|pays|income|rent(s|al)? of/i.test(openForText), (openForText.match(/\$\s?\d|per month|pays|income|rent(s|al)? of/i) || [''])[0]);

// ================= 6. The watch-area digest terms =================
const sqlUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const digestParams = [2, '%@demo.amicohaus.local', sqlUtc(Date.now() - 14 * 864e5), sqlUtc(Date.now() - 30 * 864e5), sqlUtc(Date.now())];
run("INSERT INTO watch_areas (user_id, zip) VALUES (2, '91915'), (4, '91915')");
run("INSERT INTO open_for (id, user_id, property_kind, zip, uses_json) VALUES (921, 1, 'vacant_lot', '91915', '[\"garden\"]')");
run("INSERT INTO open_for (id, user_id, property_kind, zip, uses_json) VALUES (922, 2, 'home', '91915', '[\"garden\"]')");
run("INSERT INTO deal_outlines (id, user_id, kind, use_key, zip, listed) VALUES (931, 2, 'space', 'garden', '91915', 1)");
const digest = (sql, params) => sqlite.prepare(sql).all(...params.slice(0, 4));
const outlineTerm = lib.dealOutlineDigestTermSql(), openForTerm = of.openForDigestTermSql();
let rows = digest(outlineTerm, digestParams);
check('digest term (outlines): listed, active outlines in the viewer\'s watched ZIPs; never their own, a suspended or a demo owner\'s', rows.length >= 1 && rows.every(x => x.kind === 'deal_outline' && x.zip === '91915')
  && !rows.some(x => [901, 902, 931].includes(x.ref_id)) && JSON.stringify(Object.keys(rows[0])) === JSON.stringify(['kind', 'ref_id', 'zip', 'title', 'created_at']), JSON.stringify(rows));
check('digest term (outlines): the title is the use key, and dealOutlineDigestLabel names it', rows.every(x => typeof lib.dealOutlineDigestLabel(x.title) === 'string' && lib.dealOutlineDigestLabel(x.title) !== '') && lib.dealOutlineDigestLabel('garden') === 'A garden plot');
rows = digest(openForTerm, digestParams);
check('digest term (Open For): active flag sets in watched ZIPs; never the viewer\'s own, a suspended or a demo owner\'s', rows.length >= 1 && rows.some(x => x.ref_id === 921) && !rows.some(x => [911, 912, 922].includes(x.ref_id))
  && rows.every(x => x.kind === 'open_for') && of.openForDigestLabel('vacant_lot') === 'A vacant lot', JSON.stringify(rows));
check('digest terms: a blocked pair sees nothing of each other', digest(outlineTerm, [4, ...digestParams.slice(1)]).every(x => one('SELECT user_id FROM deal_outlines WHERE id = ?', x.ref_id).user_id !== 1)
  && digest(openForTerm, [4, ...digestParams.slice(1)]).every(x => one('SELECT user_id FROM open_for WHERE id = ?', x.ref_id).user_id !== 1));
check('digest terms: each is one wrapped SELECT with LIMIT 20 and no compound of its own', [outlineTerm, openForTerm].every(s => /^SELECT \* FROM \(SELECT /.test(s) && /LIMIT 20\)$/.test(s) && !/\bUNION\b/i.test(s) && !/\?[^1-5]/.test(s.replace(/\?[1-5]/g, ''))));

// ================= 7. Idea cards =================
r = await call(cardsApi.onRequestGet, 'GET', '/api/idea-cards', null);
check('GET /api/idea-cards signed out -> 401', r.status === 401);
r = await call(cardsApi.onRequestGet, 'GET', '/api/idea-cards', 3, { env: DARK });
check('idea cards, shipped gate, a member: only the live tools\' cards (Sell and stay, Neighbors first); 1 statement; private no-store', r.status === 200 && noStore(r) && r.statements === 1 && JSON.stringify(r.json.cards.map(c => c.key)) === '["stay","first"]', JSON.stringify(r.json.cards.map(c => c.key)));
const liveText = JSON.stringify(r.json.cards);
check('idea cards, shipped gate, a member: no dark tool is mentioned (no head start sentence either)', !/easement|open for|standing interest|step|carry|test-drive|trial|head start|tower|solar/i.test(liveText), (liveText.match(/easement|open for|standing interest|step|carry|test-drive|trial|head start|tower|solar/i) || [''])[0]);
const memberStay = r.json.cards.find(c => c.key === 'stay');
check('Sell and stay card, shipped gate, a member: the default and the agents line; the "30 days or more" note (attorney item A10) waits', memberStay.lines.length === 4 && memberStay.lines[0].startsWith('Up to 29 days (the default)')
  && memberStay.lines[1] === 'Your agents write the rent-back terms. No rent amounts are set on Amico Haus.' && !/30 days|lease-back|tenancy/i.test(liveText) && cardsLib.CARD_REVIEW_CLEARED.A10 === false);
r = await call(cardsApi.onRequestGet, 'GET', '/api/idea-cards', 5, { env: DARK });
check('Sell and stay card, shipped gate, an admin: the "30 days or more" note is there to read', r.json.cards.find(c => c.key === 'stay').lines[1].startsWith('30 days or more (an option, not set on Amico Haus)'));
check('idea cards, shipped gate, an admin: all 14, in the written order', JSON.stringify(r.json.cards.map(c => c.key)) === JSON.stringify(['corner', 'across', 'permanent', 'long', 'together', 'tower', 'buyout', 'minerals', 'light', 'stay', 'carry', 'trial', 'steps', 'first']));
r = await call(cardsApi.onRequestGet, 'GET', '/api/idea-cards', 3);
const cards = r.json.cards;
check('idea cards with everything on: 14 cards, each ending with "General information. Not legal advice." and the HOA-and-city line', cards.length === 14 && cards.every(c => c.lines.at(-2) === 'General information. Not legal advice.' && c.lines.at(-1) === it.HOA_CITY_LINE));
const byKey = Object.fromEntries(cards.map(c => [c.key, c]));
check('cards carry their option notes: corner (month-to-month), permanent (easement), long (long lease), together (2 to 4 + the five-share line)', lib.TERM_OPTIONS.month_to_month.notes.every(n => byKey.corner.lines.includes(n))
  && lib.TERM_OPTIONS.recorded_easement.notes.every(n => byKey.permanent.lines.includes(n)) && lib.TERM_OPTIONS.long_lease.notes.every(n => byKey.long.lines.includes(n))
  && lib.TERM_OPTIONS.co_2_4.notes.every(n => byKey.together.lines.includes(n)) && byKey.together.lines.includes('Five or more ownership shares need a state filing. Not offered here.'));
check('tower card: LONG_LINE, TAX_LINE, NO_PAY_LINE; light card: LIGHT_LINE + the filming, events and storage notes', [of.LONG_LINE, of.TAX_LINE, of.NO_PAY_LINE].every(l => byKey.tower.lines.includes(l)) && byKey.light.lines[0] === of.LIGHT_LINE
  && [...of.OPEN_FOR_USES.filming.notes, ...of.OPEN_FOR_USES.events.notes, ...of.OPEN_FOR_USES.storage_parking.notes].every(n => byKey.light.lines.includes(n)));
check('Neighbors first: the head-start sentence shows only when the head start is on for the viewer', byKey.first.body.length === 2 && byKey.first.body[1].includes('head start')
  && cardsLib.ideaCardsFor({}, { role: 'user' }).find(c => c.key === 'first').body.length === 1 && byKey.first.lines.includes("Anyone with an account can watch any ZIP code. You don't have to live there."));
check('Sell and stay: the default, the 30-days-or-more option as a note, and no dollar sign', byKey.stay.lines[0].startsWith('Up to 29 days (the default)') && byKey.stay.lines[1].startsWith('30 days or more (an option, not set on Amico Haus)') && !/\$/.test(JSON.stringify(byKey.stay)) && byKey.stay.action === 'stay');
check('carry card: one link, to the assumable loans page; no lender name, phone, rate or percent', JSON.stringify(byKey.carry.link) === '{"href":"/assumable-loans","label":"About assumable loans"}' && !/Point Mortgage|NMLS|\d\s?%|tel:/i.test(JSON.stringify(byKey.carry)));
// Lines other files own: the card repeats them word for word.
const shared = [['functions/_lib/listingTerms.js', ['SELL_STAY_NOTE']], ['functions/_lib/stepDown.js', ['STEP_DOWN_LINE']], ['functions/_lib/tradeTrials.js', ['TRIAL_LINE', 'TRIAL_LONG_LINE']], ['functions/_lib/watchAreas.js', ['WATCH_OPEN_LINE', 'WATCH_PRECISION_LINE']]];
for (const [file, names] of shared) {
  let m = null;
  try { m = await mod(file); } catch (e) { m = null; }
  const drift = names.filter(n => m && m[n] !== undefined && m[n] !== cardsLib.CARD_SHARED_LINES[n]);
  const pending = names.filter(n => !m || m[n] === undefined);
  check(`cards repeat ${names.join(', ')} exactly as ${file} has ${pending.length ? `(not exported there yet: ${pending.join(', ')})` : 'them'}`, drift.length === 0, drift.join());
}
check('no card names a company, an attorney or a firm', !/\b(crown castle|american tower|sba|verizon|at&t|t-mobile|sunrun|tesla|airbnb|peerspace|giggster|neighbor\.com)\b/i.test(JSON.stringify(cards)) && !/attorney at law|esq\.|law (firm|office)/i.test(JSON.stringify(cards)));

// ================= 8. ideas.js (the Ideas tab) =================
const ideasSrc = read('ideas.js');
check('ideas.js: no inline style or handler, no fetch outside /api/, no location, no storage of what is typed', !/ style=/.test(ideasSrc) && !/\son[a-z]+=/.test(ideasSrc) && !/geolocation/.test(ideasSrc) && !/fetch\(/.test(ideasSrc)
  && !/localStorage|sessionStorage|document\.cookie/.test(ideasSrc) && (ideasSrc.match(/api(Get|Post|Put|Delete)\(`?'?([^`',)]*)/g) || []).every(c => /\((`|')\/api\//.test(c)), (ideasSrc.match(/api(Get|Post|Put|Delete)\([^)]*/g) || []).filter(c => !/\((`|')\/api\//.test(c)).join(' | '));
check('ideas.js: every label has for=', (ideasSrc.match(/<label\b[^>]*>/g) || []).every(l => /\sfor="/.test(l)), (ideasSrc.match(/<label\b[^>]*>/g) || []).filter(l => !/\sfor="/.test(l)).join(' '));
check('ideas.js: delegated listeners with data-action="idea-..." only', (ideasSrc.match(/data-action="([^"]*)"/g) || []).every(a => /data-action="idea-/.test(a)) && /addEventListener\('click', ideaClick\)/.test(ideasSrc));
check('ideas.js: no fee, price-to-list or payment field', !/\bfees?\b|checkout|pay now|credit card|subscribe/i.test(ideasSrc));
check('ideas.js: no stray backspace character', !ideasSrc.includes('\x08'));
check('ideas.js: the two first messages are drafts handed to startConversationWith (never sent here)', ideasSrc.includes('`About your idea outline (${o.useLabel}, ${o.zip}): `') && ideasSrc.includes('`About your Open For flag (${use}) in ${f.zip}: `')
  && /startConversationWith\(owner\.id, owner\.name, draft\)/.test(ideasSrc) && !/\/api\/conversations/.test(ideasSrc));
check('ideas.js: no offer button, price reply field or "interested" counter', !/make an offer|send an offer|counter-?offer|interested \(|interestCount/i.test(ideasSrc));

// Run the script in a sandbox to read what it draws.
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sandbox = {
  window: { NUANCED: {} }, document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
  escapeHtml, apiGet: async () => ({}), apiPost: async () => ({}), apiPut: async () => ({}), apiDelete: async () => ({}), toast() {}, toastActionError() {}, console,
};
vm.createContext(sandbox);
vm.runInContext(ideasSrc, sandbox);
const inBox = (code) => vm.runInContext(code, sandbox);
const outlineCfg = lib.outlineConfig(), openForCfg = of.openForConfig();
sandbox.cfgA = outlineCfg; sandbox.cfgB = openForCfg; sandbox.allCards = cards;
sandbox.window.NUANCED = Object.fromEntries(Object.keys(gate.NUANCED_TOOLS).map(k => [k, true]));
inBox('ideaState.outlineCfg = cfgA; ideaState.openForCfg = cfgB; ideaState.draft = ideaNewDraft();');
const builder = inBox('ideaBuilderHtml()');
check('builder: the six steps, in order', ['1. What kind of idea?', '2. Where on the lot?', '3. Which option are you looking at?', '4. Your ask (optional)', '5. Questions for your attorney', '6. Keep it private or list it']
  .every((s, i, all) => builder.includes(`<legend>${s}</legend>`) && (i === 0 || builder.indexOf(s) > builder.indexOf(all[i - 1]))));
const labelsHtml = lib.OUTLINE_LABELS.map(l => `<p class="tiny">${escapeHtml(l)}</p>`).join('');
check('builder: the three labels sit above step 1 and above the Save button', builder.split(labelsHtml).length === 3 && builder.indexOf(labelsHtml) < builder.indexOf('1. What kind of idea?')
  && builder.lastIndexOf(labelsHtml) > builder.indexOf('6. Keep it private or list it') && builder.lastIndexOf(labelsHtml) < builder.indexOf('>Save</button>'));
check('builder: starts on month_to_month, with NO_RECOMMEND_LINE above the options', /id="ideaTerm-month_to_month" value="month_to_month" checked/.test(builder) && (builder.match(/name="ideaTerm"[^>]* checked/g) || []).length === 1
  && builder.indexOf(escapeHtml(lib.NO_RECOMMEND_LINE)) > builder.indexOf('3. Which option are you looking at?') && builder.indexOf(escapeHtml(lib.NO_RECOMMEND_LINE)) < builder.indexOf('class="outline-ladder"'));
const optionBlocks = builder.slice(builder.indexOf('class="outline-ladder"'), builder.indexOf('4. Your ask (optional)')).split('<div class="outline-option">').slice(1);
check('builder: four option blocks, each with its notes, each ending with the HOA-and-city line', optionBlocks.length === 4 && optionBlocks.every((b, i) => {
  const o = outlineCfg.kinds[0].ladder[i];
  return b.includes(escapeHtml(o.label)) && o.notes.every(n => b.includes(escapeHtml(n))) && b.trim().replace(/\s*<\/div>\s*(<\/div>\s*<\/fieldset>\s*<fieldset class="panel"><legend>)?$/, '').endsWith(`<p class="tiny">${escapeHtml(it.HOA_CITY_LINE)}</p>`);
}), optionBlocks.map(b => b.trim().slice(-120)).join(' || '));
check('builder: private by default, the listing box unticked, both listing lines', /id="ideaListNo" value="0" checked/.test(builder) && /id="ideaListAck">/.test(builder) && builder.includes(escapeHtml(lib.LIST_ACK)) && lib.LISTING_LINES.every(l => builder.includes(escapeHtml(l)))
  && builder.includes('Only I see it') && builder.includes('List it for members to find'));
check('builder: the tap grid (two modes, street side), the sketch line, "Describe it", the ask line', builder.includes('Tap the squares the idea covers') && builder.includes('Tap where the house is') && builder.includes('<label for="ideaStreet">Street side</label>')
  && builder.includes('<label for="ideaAreaNote">Describe it</label>') && (builder.match(/data-idea-cell="/g) || []).length === 144 && builder.includes(escapeHtml(lib.SKETCH_LINE)) && builder.includes(escapeHtml(lib.ASK_LINE)));
inBox("ideaState.draft.kind = 'co_ownership'; ideaState.draft.useKey = 'whole_home'; ideaState.draft.termOption = 'co_2_4';");
const coBuilder = inBox('ideaBuilderHtml()');
check('builder, sharing ownership: starts on co_2_4, shows "Not offered here." on the other two, has no listing choice, and the ask is one time', /id="ideaTerm-co_2_4" value="co_2_4" checked/.test(coBuilder) && (coBuilder.match(/Not offered here\./g) || []).length === 2
  && !coBuilder.includes('ideaListYes') && !coBuilder.includes(escapeHtml(lib.LIST_ACK)) && /<select id="ideaAskPer"><option value="once" selected>one time<\/option><\/select>/.test(coBuilder));
inBox("ideaState.draft.kind = 'space'; ideaState.draft.useKey = 'pool'; ideaState.draft.termOption = 'month_to_month';");
const poolBuilder = inBox('ideaBuilderHtml()');
check('builder, a pool: no ask field, the pool line instead', !poolBuilder.includes('ideaAskAmount') && poolBuilder.includes(escapeHtml(lib.POOL_LINE)));
// The sketch drawn in the browser is the server's picture.
const sketches = [{ cells: [], house: [], street: '' }, { cells: [0, 13, 143], house: [5, 6], street: 'top' }, { cells: [70], house: [71, 72, 83], street: 'left' }, { cells: [1], house: [], street: 'right' }, { cells: [], house: [100], street: 'bottom' }];
sandbox.sketches = sketches;
check('ideaSketchSvg(sketch) === the server\'s sketchSvg(sketch) for 5 sketches', sketches.every((s, i) => inBox(`ideaSketchSvg(sketches[${i}], false)`) === lib.sketchSvg(s)));
// Cards and links.
const cardHtml = inBox('allCards.map(ideaCardHtml).join("")');
check('cards as drawn: every title, body line and note, escaped', cards.every(c => cardHtml.includes(`<summary><strong>${escapeHtml(c.title)}</strong></summary>`) && c.lines.every(l => cardHtml.includes(`<li>${escapeHtml(l)}</li>`)) && c.body.every(b => cardHtml.includes(`<p>${escapeHtml(b)}</p>`))));
check('ideas.js card index === the server\'s cards (keys, gates, titles)', JSON.stringify(inBox('JSON.stringify(Object.entries(IDEA_CARD_INDEX))')) === JSON.stringify(JSON.stringify(cardsLib.IDEA_CARDS.map(c => [c.key, c.titleWhen ? [c.tool, c.title, c.titleWhen.tool, c.titleWhen.title] : [c.tool, c.title]]))));
check('the watch-areas card is "Watch a ZIP code" until the head start is on for the viewer, then "Neighbors first" (server and app agree)',
  cardsLib.ideaCardsFor({}, { role: 'user' }).find(c => c.key === 'first').title === 'Watch a ZIP code' && cardsLib.ideaCardsFor({}, { role: 'admin' }).find(c => c.key === 'first').title === 'Neighbors first'
  && cards.find(c => c.key === 'first').title === 'Neighbors first'
  && (sandbox.window.NUANCED = { watchAreas: true }, inBox("ideaCardLinkHtml('first')").endsWith('>Idea card: Watch a ZIP code</a>'))
  && (sandbox.window.NUANCED = { watchAreas: true, headStart: true }, inBox("ideaCardLinkHtml('first')").endsWith('>Idea card: Neighbors first</a>'))
  && (sandbox.window.NUANCED = Object.fromEntries(Object.keys(gate.NUANCED_TOOLS).map(k => [k, true])), true));
check('ideaCardLinkHtml: a link when the card\'s tool is on, nothing when it is off or unknown', /^<a class="tiny" href="\/app#ideas" data-action="idea-open-card" data-idea-card="stay">Idea card: Sell and stay<\/a>$/.test(inBox("ideaCardLinkHtml('stay')")) && inBox("ideaCardLinkHtml('nope')") === ''
  && (sandbox.window.NUANCED = { sellAndStay: true }, inBox("ideaCardLinkHtml('corner')") === '' && inBox("ideaCardLinkHtml('stay')") !== ''));
sandbox.window.NUANCED = Object.fromEntries(Object.keys(gate.NUANCED_TOOLS).map(k => [k, true]));
sandbox.oneFlag = flag; sandbox.oneCard = card;
const flagHtml = inBox('ideaFlagBodyHtml(oneFlag)');
check('Open For card as drawn: OPEN_FOR_LINE, the city line, NO_PAY_LINE, and with a long use LONG_LINE + TAX_LINE; long uses marked', [of.OPEN_FOR_LINE, of.OPEN_FOR_CITY_LINE, of.NO_PAY_LINE, of.LONG_LINE, of.TAX_LINE].every(l => flagHtml.includes(escapeHtml(l)))
  && /class="chip open-for-chip open-for-long">Antenna or small cell site</.test(flagHtml) && /class="chip open-for-chip">Hunting</.test(flagHtml) && flagHtml.includes('About the property (from the owner)'));
check('Open For card as drawn: nothing about what a use pays outside NO_PAY_LINE', !/\$\s?\d|per month|pays|income|rent(s|al)? of/i.test(flagHtml.split(escapeHtml(of.NO_PAY_LINE)).join('')));
const foundHtml = inBox('ideaFoundOutlineHtml(oneCard)');
check('a listed outline as drawn: "(from the owner)", the not-an-easement label, both listing lines, the HOA-and-city line, "Message the owner"', foundHtml.includes('Idea outline (from the owner)') && foundHtml.includes(escapeHtml(lib.OUTLINE_LABELS[1]))
  && lib.LISTING_LINES.every(l => foundHtml.includes(escapeHtml(l))) && foundHtml.includes(escapeHtml(it.HOA_CITY_LINE)) && />Message the owner<\/button>/.test(foundHtml));
check('a listed outline as drawn for another member: all three labels (not a lease or contract; nothing binding), and the ask and sketch lines speak of the owner, never "your"',
  lib.OUTLINE_LABELS.every(l => foundHtml.includes(escapeHtml(l))) && !foundHtml.includes(escapeHtml(lib.ASK_LINE)) && !foundHtml.includes(escapeHtml(lib.SKETCH_LINE))
  && (!sandbox.oneCard.ask || foundHtml.includes(escapeHtml(lib.ASK_VIEWER_LINE)))
  && inBox('ideaFoundOutlineHtml({ ...oneCard, ask: { amount: 300, per: "month" }, sketch: { cells: [1, 2], house: [40], street: "" } })').includes(escapeHtml(lib.ASK_VIEWER_LINE))
  && inBox('ideaFoundOutlineHtml({ ...oneCard, sketch: { cells: [1, 2], house: [40], street: "" } })').includes(escapeHtml(lib.SKETCH_VIEWER_LINE))
  && inBox('ideaMyOutlineHtml({ ...oneCard, listed: true, ask: { amount: 300, per: "month" }, sketch: { cells: [1, 2], house: [40], street: "" } })').includes(escapeHtml(lib.ASK_LINE))
  && inBox('ideaMyOutlineHtml({ ...oneCard, listed: true, sketch: { cells: [1, 2], house: [40], street: "" } })').includes(escapeHtml(lib.SKETCH_LINE)), foundHtml.slice(0, 600));
inBox('ideaState.flagDraft = ideaNewFlagDraft(); ideaState.flagDraft.propertyKind = "rural_land"; ideaState.flagDraft.uses = ["hunting", "sign"];');
const flagForm = inBox('ideaOpenForFormHtml()');
check('Open For form: the two groups, each ticked use\'s notes under it, the long-lease box, the three lines above Save', flagForm.includes('<legend>By the day or month-to-month</legend>') && flagForm.includes('<legend>Long leases (read the notes first)</legend>')
  && of.OPEN_FOR_USES.hunting.notes.every(n => flagForm.includes(escapeHtml(n))) && of.OPEN_FOR_USES.sign.notes.every(n => flagForm.includes(escapeHtml(n))) && !flagForm.includes(escapeHtml(of.OPEN_FOR_USES.filming.notes[0]))
  && flagForm.includes(escapeHtml(of.LONG_ACK)) && /id="ideaOfLongAck">/.test(flagForm) && [of.OPEN_FOR_LINE, of.OPEN_FOR_CITY_LINE, of.NO_PAY_LINE].every(l => flagForm.lastIndexOf(escapeHtml(l)) > flagForm.indexOf('ideaOfState') && flagForm.lastIndexOf(escapeHtml(l)) < flagForm.indexOf('>Save</button>')));
inBox('ideaState.flagDraft.propertyKind = "home"; ideaState.flagDraft.uses = ["garden"];');
const homeForm = inBox('ideaOpenForFormHtml()');
check('Open For form, a home: hunting, recreation, grazing and ground solar aren\'t offered; no long-lease box until a long use is ticked; no price or term field', !/ideaOfUse-(hunting|recreation|grazing|solar_ground)"/.test(homeForm) && !homeForm.includes('ideaOfLongAck')
  && !/price|\$|per month|term\b/i.test(homeForm.replace(/long-term/gi, '')));

// ================= 9. Never recommends, never a document =================
const RECOMMEND = /recommend(ed)?\b(?! one)|best option|we suggest|you should|safest|easiest|no rules|rule-free|is legal|is allowed|fully legal|approved/i;
const ladderHtml = builder.slice(builder.indexOf('3. Which option are you looking at?'), builder.indexOf('4. Your ask (optional)')) + coBuilder.slice(coBuilder.indexOf('3. Which option are you looking at?'), coBuilder.indexOf('4. Your ask (optional)'));
check('never recommends: the ladder as drawn (the one allowed sentence is NO_RECOMMEND_LINE)', !RECOMMEND.test(ladderHtml), (ladderHtml.match(RECOMMEND) || [''])[0]);
check('never recommends: every idea card', !RECOMMEND.test(JSON.stringify(cards)), (JSON.stringify(cards).match(RECOMMEND) || [''])[0]);
check('never recommends: the option notes, the Open For notes and lines, the packet', !RECOMMEND.test(JSON.stringify(lib.TERM_OPTIONS)) && !RECOMMEND.test(JSON.stringify(openForCfg)) && !RECOMMEND.test(body), (JSON.stringify(openForCfg).match(RECOMMEND) || body.match(RECOMMEND) || [''])[0]);
check('no option is called easier, better, safer or the lightest except in NO_RECOMMEND_LINE', !/\b(easier|better|safer|simplest|lightest|smart(er|est)?)\b/i.test(JSON.stringify(lib.TERM_OPTIONS) + JSON.stringify(cards) + ladderHtml.split(escapeHtml(lib.NO_RECOMMEND_LINE)).join('')));
const DOCUMENT = /grantor|grantee|hereby|witnesseth|in witness|legal description|notary/i;
const everything = seen.join('\n') + cardHtml + builder + coBuilder + flagForm + JSON.stringify(outlineCfg) + JSON.stringify(openForCfg);
check('never a document: no response, page, card or form says grantor, grantee, hereby, witnesseth, legal description or notary', !DOCUMENT.test(everything), (everything.match(DOCUMENT) || [''])[0]);
check('no response carries an address field (none is stored)', !/"address"|"apn"|"parcel"|"street_label"|"streetLabel"/i.test(seen.filter(t => t.startsWith('{')).join('\n')));
check('none of these files names the people Amico Haus never mentions', ['ideas.js', 'functions/_lib/dealOutlines.js', 'functions/_lib/openFor.js', 'functions/_lib/ideaCards.js', 'functions/api/deal-outlines/index.js', 'functions/api/deal-outlines/[id].js',
  'functions/api/open-for/index.js', 'functions/api/open-for/[id].js', 'functions/api/idea-cards.js', 'functions/idea-outline/[id].js', 'whats-new.html', 'llms.txt'].every(f => !/McKelvey|Patti|\bJeff\b/i.test(read(f))));
check('the server files: no stray backspace character, no alertAdmin, no email or push', ['functions/_lib/dealOutlines.js', 'functions/_lib/openFor.js', 'functions/_lib/ideaCards.js', 'functions/api/deal-outlines/index.js', 'functions/api/deal-outlines/[id].js',
  'functions/api/open-for/index.js', 'functions/api/open-for/[id].js', 'functions/api/idea-cards.js', 'functions/idea-outline/[id].js'].every(f => !read(f).includes('\x08') && !/alertAdmin|notifyAndMaybeEmail|sendEmail|webpush|INSERT INTO notifications/.test(read(f))));
check('nothing from these tools is on a public page: the sitemap, search and JSON-LD files never mention them', ['functions/sitemap.xml.js', 'functions/api/search.js', 'functions/_lib/structuredData.js'].every(f => !existsSync(`${root}/${f}`) || !/deal_outlines|open_for|idea-outline|idea-cards/.test(read(f))));

// ================= 10. Terms, Privacy, What's New, llms.txt =================
const terms = read('terms.html'), privacy = read('privacy.html'), whatsNew = read('whats-new.html'), llms = read('llms.txt');
const T = await mod('functions/_lib/terms.js');
const SECTION_22 = "<h2>22. Idea tools, standing interest and trial stays</h2><p>Idea outlines, Open For flags, standing interest, price schedules, terms wish lists and trial stays are information that members share with each other. None of them is an offer, a contract, an easement, a lease or legal advice, and Amico Haus does not write legal documents, negotiate, hold money or take part in any deal. Anything you agree to is between you and the other person, in writing, with your own agents and attorney. Facts about a home on these tools (bills, measurements, signal tests) are the owner's own and are not checked by Amico Haus. Carrier and utility figures come from the FCC and SDG&amp;E as they publish them. Check your HOA rules, your city's rules, your lender and your insurance before you act on any idea.</p>";
check('terms.html: section 22, word for word, once, after section 21', terms.split(SECTION_22).length === 2 && terms.indexOf(SECTION_22) > terms.indexOf('<h2>21. Translations</h2>') && (terms.match(/<h2[^>]*>\d+\./g) || []).length === 22);
const PRIV_COLLECT = "the ZIP codes you watch; a ZIP code and street name if you tell us where your home is (never a house number); standing interest you post (an amount, home type, bedrooms, cash or financed, timing and where it is for; nothing else about you); for a home you post, its ZIP code, monthly bills, solar details, room measurements, signal tests, the sale terms you rank, any financing flags and any price schedule; idea outlines (with your sketch and your ask); Open For flags; and for a trial stay, the dates, the checklist you ticked and when each of you said yes";
const PRIV_SEE = "<p>Standing interest is never public. It is shown, without your name, only to members who have a home on Amico Haus in that ZIP code, who own the pre-listing it is for, or who told us their home is in that ZIP code or on that street. We don't check those statements. If one of them replies, they see your display name in Messages. Your watch areas are private. During a head start, a home is shown first to members who watch its ZIP code. Bills, solar details, measurements and signal tests you enter show as your own on your listing; a trade listing is a public page, and on a pre-listing only approved agents and admins see them. Where ZIP code ranges are turned on, your monthly bills may also be counted, without your name or your home, in a low-to-high range for similar-size homes in your ZIP code, shown to signed-in members only when 5 or more owners entered that bill. Idea outlines you list and Open For flags show to signed-in members with your display name, city and ZIP code; an outline you keep private shows only to you. A trial stay shows only to the two owners.</p>";
const sec = (n) => privacy.slice(privacy.indexOf(`<h2>${n}.`), privacy.indexOf(`<h2>${n + 1}.`));
check('privacy.html §1: the "what we collect" addition, word for word, once', privacy.split(PRIV_COLLECT).length === 2 && sec(1).includes(`<li><strong>Watch areas and idea tools:</strong> ${PRIV_COLLECT}.</li>`));
check('privacy.html §3: the "who can see what" paragraph, word for word, once', privacy.split(PRIV_SEE).length === 2 && sec(3).includes(PRIV_SEE));
check('privacy.html: no new third party (section 5 is as it was: no FCC, SDG&E or State Bar there)', !/FCC|SDG&amp;E|State Bar/i.test(sec(5)));
check('the dates move together: terms.js, terms.html, privacy.html', /^\d{4}-\d{2}-\d{2}$/.test(T.CURRENT_TERMS_VERSION) && T.CURRENT_TERMS_VERSION > '2026-11-11' && terms.includes(`Last updated ${T.TERMS_UPDATED_LABEL} (version ${T.CURRENT_TERMS_VERSION}).`)
  && privacy.includes(`<p class="section-sub">Last updated ${T.TERMS_UPDATED_LABEL}.</p>`)
  && new Date(`${T.CURRENT_TERMS_VERSION}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) === T.TERMS_UPDATED_LABEL);
const newCard = whatsNew.slice(whatsNew.indexOf('<div class="card about-card">'), whatsNew.indexOf('</div>', whatsNew.indexOf('<div class="card about-card">')));
check("whats-new.html: the new card is first, with one line for each tool that ships live (six)", newCard.includes('<h2>Bills, room sizes, signal, wish lists and watch areas</h2>') && (newCard.match(/<li>/g) || []).length === 6
  && ['monthly bills and solar', 'Will it fit?', 'speed tests and cell signal bars', 'wish list about the sale, never about the buyer', 'Watch up to 3 ZIP codes', 'Sell and stay'].every(s => newCard.includes(s)));
const DARK_WORDS = /easement|open for|standing|step-down|carry|test-drive|head start/i;
check("whats-new.html mentions no dark tool", !DARK_WORDS.test(whatsNew), (whatsNew.match(DARK_WORDS) || [''])[0]);
const LLMS_NEW = ['- **Bills and solar**:', '- **Will it fit?**:', '- **Signal log**:', '- **Terms wish list**:', '- **Watch areas**:', '- **Sell and stay**:'];
const llmsLines = llms.split('\n');
check('llms.txt: one line for each of the same six, under Key concepts (Agent Strategy)', LLMS_NEW.every(l => llmsLines.filter(x => x.startsWith(l)).length === 1)
  && llms.indexOf(LLMS_NEW[0]) > llms.indexOf('## Key concepts (Agent Strategy)') && llms.indexOf(LLMS_NEW[5]) < llms.indexOf('## Key concepts (home trading)'));
check('llms.txt mentions no dark tool', !DARK_WORDS.test(llms), (llms.match(DARK_WORDS) || [''])[0]);
const newCopy = newCard + llmsLines.filter(x => LLMS_NEW.some(l => x.startsWith(l))).join('\n');
check('the new What\'s New and llms.txt lines: watch areas are ZIP codes anyone can watch (never "1 mile", "radius", "residents" or "your neighborhood")', /Anyone with an account can watch any ZIP code/.test(newCard) && !/1 mile|radius|resident|neighbors only|locals only|your neighborhood/i.test(newCopy));
check('the new What\'s New and llms.txt lines make no value, savings, ranking or guarantee claim', !/\bvalue\b|\bsav(e|ings)\b|payback|guarantee|verified|best|ideal|score|will fit\b|total|worth|accura|invest/i.test(newCopy), (newCopy.match(/\bvalue\b|\bsav(e|ings)\b|payback|guarantee|verified|best|ideal|score|will fit\b|total|worth|accura|invest/i) || [''])[0]);
check('es/terminos.html: still 21 items (the 22nd waits for the reviewed Spanish wording); es/privacidad.html unchanged at 10', (read('es/terminos.html').match(/<ol>([\s\S]*?)<\/ol>/)[1].match(/<li>/g) || []).length === 21
  && (read('es/privacidad.html').match(/<ol>([\s\S]*?)<\/ol>/)[1].match(/<li>/g) || []).length === 10);
check('the copy pages: no inline style or handler', [terms, privacy, whatsNew].every(h => !/\sstyle="|\son[a-z]+="/i.test(h)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
