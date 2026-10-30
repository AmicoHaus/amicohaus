// Runs the real handlers for batch A (agent supply): the 3-minute apply (DRE number rules, optional fees), the DRE
// check stamp, founding agents, the "Unlock your ZIP" board and a pre-listing's ZIP coverage, against an in-memory
// SQLite stand-in for D1. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/agent-supply-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
};
const env = { DB };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const call = async (handler, method, path, who, params, body) => {
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: { Cookie: `ah_session=t${who}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const res = await handler({ request, env, params: params || {}, waitUntil(p) { if (p && p.catch) p.catch(() => {}); } });
  return { status: res.status, json: await res.json().catch(() => null) };
};
console.log = () => {};

// Make sure the launch ZIPs exist in zip_codes (service-ZIP validation looks them up).
for (const [zip, lat, lng] of [['91910', 32.637, -117.06], ['91911', 32.607, -117.05], ['91913', 32.62, -116.99], ['91914', 32.66, -116.96], ['91915', 32.62, -116.95], ['91902', 32.67, -117.01], ['92104', 32.74, -117.13]]) {
  sqlite.prepare('INSERT OR IGNORE INTO zip_codes (zip, lat, lng) VALUES (?, ?, ?)').run(zip, lat, lng);
}
// 1 admin, 2-6 agents, 7 homeowner, 8 demo homeowner, 9-11 buyers, 12 demo buyer, 13 and 15-17 agents (91910 race),
// 14 demo agent.
for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) {
  const demo = id === 8 || id === 12 || id === 14;
  sqlite.prepare('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)').run(id, demo ? `d${id}@demo.amicohaus.local` : `u${id}@example.test`, `User ${id}`, id === 1 ? 'admin' : 'user');
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
}

const apply = await mod('functions/api/agents/apply.js');
const decide = await mod('functions/api/admin/agent-applications/[id].js');
const verify = await mod('functions/api/admin/agent-applications/[id]/verify-license.js');
const base = { brokerageName: 'Bay Realty', serviceZips: ['91913'] };

// --- 3-minute apply ---
let r = await call(apply.onRequestPost, 'POST', '/x', 2, null, { ...base, licenseNumber: 'DRE #1234567' });
const lic2 = sqlite.prepare('SELECT license_number, default_commission_pct, default_flat_fee FROM agent_profiles WHERE user_id = 2').get();
check('applying needs only a DRE number, brokerage and ZIP (no fee)', r.status === 201 && lic2.default_commission_pct === null && lic2.default_flat_fee === null, JSON.stringify(r.json));
check('"DRE #1234567" is stored as the 8-digit ID 01234567', lic2.license_number === '01234567', lic2.license_number);
r = await call(apply.onRequestPost, 'POST', '/x', 3, null, { ...base, licenseNumber: 'FAKE-1' });
check('a non-DRE license number is refused with a clear message', r.status === 400 && /California DRE license number/.test(r.json.error), JSON.stringify(r.json));
r = await call(apply.onRequestPost, 'POST', '/x', 3, null, { ...base, licenseNumber: '123456789' });
check('a number longer than 8 digits is refused', r.status === 400);

// --- DRE check stamp (no license photo needed), tied to the number shown; approval grants founding spots ---
r = await call(verify.onRequestPut, 'PUT', '/x', 1, { id: '2' }, { verified: true, licenseNumber: '09999999' });
check('a DRE check for a number other than the one on file is refused (409)', r.status === 409 && sqlite.prepare('SELECT license_verified FROM agent_profiles WHERE user_id = 2').get().license_verified === 0, JSON.stringify(r));
r = await call(verify.onRequestPut, 'PUT', '/x', 1, { id: '2' }, { verified: true });
check('a DRE check has to say which number was checked', r.status === 400);
r = await call(verify.onRequestPut, 'PUT', '/x', 1, { id: '2' }, { verified: true, licenseNumber: '01234567' });
check('an admin can mark a license checked on the DRE without a license photo', r.status === 200 && sqlite.prepare('SELECT license_verified FROM agent_profiles WHERE user_id = 2').get().license_verified === 1);
r = await call(verify.onRequestPut, 'PUT', '/x', 7, { id: '2' }, { verified: true, licenseNumber: '01234567' });
check('a non-admin cannot', r.status === 403);
r = await call(decide.onRequestPut, 'PUT', '/x', 1, { id: '2' }, { decision: 'approve' });
check('approving has to say which license number was checked', r.status === 400);
r = await call(decide.onRequestPut, 'PUT', '/x', 1, { id: '2' }, { decision: 'approve', licenseNumber: '01234566' });
check('approving with a number that is no longer on file is refused (409)', r.status === 409 && sqlite.prepare('SELECT status FROM agent_profiles WHERE user_id = 2').get().status === 'pending');
r = await call(decide.onRequestPut, 'PUT', '/x', 1, { id: '2' }, { decision: 'approve', licenseNumber: '01234567' });
const f2 = sqlite.prepare("SELECT zip FROM founding_agents WHERE agent_user_id = 2").all().map(x => x.zip);
check('approving an agent in a launch ZIP makes them a founding agent there', r.status === 200 && f2.join() === '91913', JSON.stringify(f2));
const note2 = sqlite.prepare("SELECT body FROM notifications WHERE user_id = 2 ORDER BY id DESC").get();
check('the approval message says which ZIPs they are a founding agent in', note2 && /founding agent in 91913/.test(note2.body), note2 && note2.body);
const approve = (id, lic) => call(decide.onRequestPut, 'PUT', '/x', 1, { id: String(id) }, { decision: 'approve', licenseNumber: lic });
for (const id of [3, 4, 5]) {
  await call(apply.onRequestPost, 'POST', '/x', id, null, { brokerageName: `Realty ${id}`, licenseNumber: `0100000${id}`, serviceZips: ['91913', '92104'] });
  await approve(id, `0100000${id}`);
}
const f913 = sqlite.prepare("SELECT agent_user_id FROM founding_agents WHERE zip = '91913' ORDER BY id").all().map(x => x.agent_user_id);
check('only the first 3 approved agents get founding spots in a ZIP', f913.join() === '2,3,4', JSON.stringify(f913));
check('ZIPs outside the launch area never get founding spots', sqlite.prepare("SELECT COUNT(*) AS n FROM founding_agents WHERE zip = '92104'").get().n === 0);
await call(apply.onRequestPost, 'POST', '/x', 6, null, { brokerageName: 'Realty 6', licenseNumber: '01000006', serviceZips: ['91902'] });
check('a pending application gets no founding spot', sqlite.prepare('SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 6').get().n === 0);
await approve(6, '01000006');
await call(apply.onRequestPost, 'POST', '/x', 5, null, { brokerageName: 'Realty 5', licenseNumber: '01000005', serviceZips: ['91913', '91902'] });
check('editing a profile never grants a founding spot (only an admin approval does)', sqlite.prepare("SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 5 AND zip = '91902'").get().n === 0);
r = await approve(5, '01000005');
check('re-approving an agent who added a launch ZIP gives them the open spot there', r.status === 200 && sqlite.prepare("SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 5 AND zip = '91902'").get().n === 1);
check('...and tells them in the app', /founding agent in 91902/.test(sqlite.prepare("SELECT body FROM notifications WHERE user_id = 5 ORDER BY id DESC").get().body));

// Four approvals racing for the 3 spots in 91910: each insert counts the holders itself, so exactly 3 get one.
for (const id of [13, 15, 16, 17]) await call(apply.onRequestPost, 'POST', '/x', id, null, { brokerageName: `Realty ${id}`, licenseNumber: `020000${id}`, serviceZips: ['91910'] });
await Promise.all([13, 15, 16, 17].map(id => approve(id, `020000${id}`)));
check('approvals at the same moment never hand out more than 3 spots in a ZIP', sqlite.prepare("SELECT COUNT(*) AS n FROM founding_agents WHERE zip = '91910'").get().n === 3);
await call(apply.onRequestPost, 'POST', '/x', 14, null, { brokerageName: 'Demo Realty', licenseNumber: '02000014', serviceZips: ['91911'] });
await approve(14, '02000014');
check('a demo agent never takes a founding spot', sqlite.prepare('SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 14').get().n === 0);

// --- ZIP board ---
const board = await mod('functions/api/zip-board.js');
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, created_at) VALUES (10, 7, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, datetime('now', '-1 hour'))").run();
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price) VALUES (11, 8, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000)").run();
for (const [uid, loc] of [[9, 'Chula Vista'], [10, 'chula vista'], [11, 'Chula Vista CA'], [12, 'Chula Vista'], [9, 'Bonita']]) sqlite.prepare("INSERT INTO saved_searches (user_id, locations) VALUES (?, ?)").run(uid, loc);
r = await call(board.onRequestGet, 'GET', '/api/zip-board', 7);
const z913 = r.json.zips.find(z => z.zip === '91913');
const z902 = r.json.zips.find(z => z.zip === '91902');
check('the board lists every launch ZIP', r.json.zips.length === 6);
check('one real homeowner waiting shows as "a few" (the demo one never counts)', z913.homeownersWaiting === 'a few', JSON.stringify(z913));
check('3 real buyers watching Chula Vista are counted (demo excluded)', z913.buyersWatching === 3, JSON.stringify(z913));
check('agents serving and founding spots are exact', z913.agents === 4 && z913.foundingTaken === 3 && z913.foundingOpen === 0, JSON.stringify(z913));
check('a ZIP with 1 buyer shows "a few", and its open founding spots', z902.buyersWatching === 'a few' && z902.foundingOpen === 1 && z902.agents === 2, JSON.stringify(z902));

// --- Pre-listing ZIP coverage ---
const detail = await mod('functions/api/pre-listings/[id].js');
r = await call(detail.onRequestGet, 'GET', '/x', 7, { id: '10' });
const cov = r.json.preListing.zipCoverage;
check('the owner sees the founding-agent first-opinion time (48 hours after posting)', cov && cov.foundingAgents === 3 && Math.abs(Date.parse(cov.firstOpinionBy) - (Date.now() + 47 * 3600000)) < 120000, JSON.stringify(cov));
r = await call(detail.onRequestGet, 'GET', '/x', 3, { id: '10' });
check('a founding agent in that ZIP is told they are one', r.json.preListing.zipCoverage.viewerIsFounding === true);
r = await call(detail.onRequestGet, 'GET', '/x', 6, { id: '10' });
check('another agent is not', r.json.preListing.zipCoverage.viewerIsFounding === false);

// --- Founding ribbon on proposals ---
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, commission_pct, status) VALUES ('pre_listing', 10, 3, 2.5, 'pending'), ('pre_listing', 10, 6, 2.5, 'pending')").run();
r = await call(detail.onRequestGet, 'GET', '/x', 7, { id: '10' });
const bids = r.json.bids;
check("proposals carry each agent's founding ZIPs", bids.find(b => b.agentUserId === 3).foundingZips.join() === '91913' && bids.find(b => b.agentUserId === 6).foundingZips.join() === '91902', JSON.stringify(bids.map(b => b.foundingZips)));

// --- A spot lasts while the agent stays approved, active and serving the ZIP ---
const boardZip = async (zip) => (await call(board.onRequestGet, 'GET', '/api/zip-board', 7)).json.zips.find(z => z.zip === zip);
r = await call(apply.onRequestPost, 'POST', '/x', 3, null, { brokerageName: 'Realty 3', licenseNumber: '01000003', serviceZips: ['92104'] });
check('an agent who drops a launch ZIP gives up that founding spot', sqlite.prepare("SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 3 AND zip = '91913'").get().n === 0);
check('...which opens it up on the board', (await boardZip('91913')).foundingOpen === 1);
r = await call(detail.onRequestGet, 'GET', '/x', 3, { id: '10' });
check('...and they are no longer told they are a founding agent there', r.json.preListing.zipCoverage === undefined || r.json.preListing.zipCoverage.viewerIsFounding === false);
sqlite.prepare("UPDATE users SET status = 'suspended' WHERE id = 4").run();
check('a suspended founding agent stops counting', (await boardZip('91913')).foundingTaken === 1);
check("...and their ribbon doesn't show", !(await (await mod('functions/_lib/zipBoard.js')).fetchFoundingZips(DB, [4])).get(4));
sqlite.prepare("UPDATE users SET status = 'active' WHERE id = 4").run();
r = await call(decide.onRequestPut, 'PUT', '/x', 1, { id: '2' }, { decision: 'reject', rejectionReason: 'License expired' });
const p2 = sqlite.prepare('SELECT status, license_verified, license_verified_at FROM agent_profiles WHERE user_id = 2').get();
check('removing an approval clears the DRE check and the founding spots', r.status === 200 && p2.status === 'rejected' && p2.license_verified === 0 && p2.license_verified_at === null && sqlite.prepare('SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 2').get().n === 0, JSON.stringify(p2));
r = await call(verify.onRequestPut, 'PUT', '/x', 1, { id: '6' }, { verified: true, licenseNumber: '01000006' });
r = await call(verify.onRequestPut, 'PUT', '/x', 1, { id: '6' }, { verified: false });
const p6 = sqlite.prepare('SELECT license_verified, license_verified_at FROM agent_profiles WHERE user_id = 6').get();
check('"License not active" removes the check and its date', r.status === 200 && p6.license_verified === 0 && p6.license_verified_at === null, JSON.stringify(p6));
r = await call(apply.onRequestPost, 'POST', '/x', 6, null, { brokerageName: 'Realty 6', licenseNumber: '01000066', serviceZips: ['91902'] });
check('an agent changing their license number is flagged (so the admin checks it again)', r.status === 201 && r.json.licenseChanged === true, JSON.stringify(r.json));

// The owner of a pre-listing is never "the founding agent" on their own home.
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price) VALUES (12, 5, 'Bonita', 'CA', '91902', 'House', 3, 2, 900000)").run();
r = await call(detail.onRequestGet, 'GET', '/x', 5, { id: '12' });
check('a founding agent who owns the pre-listing is not told to send a price opinion on it', r.json.preListing.zipCoverage && r.json.preListing.zipCoverage.viewerIsFounding === false, JSON.stringify(r.json.preListing.zipCoverage));

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
