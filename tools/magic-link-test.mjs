// Runs the real signup handler against an in-memory SQLite stand-in for D1 (no network): email failures, hashed tokens, escaping.
// Usage: node --disable-warning=ExperimentalWarning tools/magic-link-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));

// Minimal D1 look-alike: prepare().bind().first()/all()/run()
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
};

const signup = (await import(pathToFileURL(`${root}/functions/api/auth/signup.js`).href)).onRequestPost;
const call = async (email, env) => {
  const request = new Request('https://amicohaus.com/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify({ displayName: 'Test Person', email }) });
  const res = await signup({ request, env: { DB, ...env }, waitUntil() {} });
  return { status: res.status, body: await res.json() };
};
const count = (email) => sqlite.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(email).n;

let failed = 0;
const realLog = console.log;
const check = (label, ok, detail = "") => { if (!ok) failed++; realLog(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : "  " + detail}`); };
const silence = console.log; console.log = () => {};   // sendEmail logs when unconfigured

// 1) No email provider configured: the pending account is kept (nothing is usable until the link is
//    opened) and the caller is told the email is delayed, so the next screen can offer "send it again".
const r1 = await call('new.person@example.test', {});
check('unavailable email -> 202 emailDelayed, pending account kept', r1.status === 202 && r1.body.pendingConfirmation === true && r1.body.emailDelayed === true && count('new.person@example.test') === 1, JSON.stringify(r1));

// 2) Provider rejects the send (like Resend returning an error), or the request itself fails.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{"message":"nope"}', { status: 422 });
const r2 = await call('rejected@example.test', { RESEND_API_KEY: 'key' });
check('provider rejects the send -> 202 emailDelayed, row kept', r2.status === 202 && r2.body.emailDelayed === true && count('rejected@example.test') === 1, JSON.stringify(r2));
globalThis.fetch = async () => { throw new Error('network down'); };
const r2b = await call('network@example.test', { RESEND_API_KEY: 'key' });
check('a network error on the send -> 202 emailDelayed, not a crash', r2b.status === 202 && r2b.body.emailDelayed === true, JSON.stringify(r2b));

// 3) A pending account whose re-send fails is kept, and the caller is told.
sqlite.prepare("INSERT INTO users (email, password_hash, display_name, email_confirmation_pending, referral_code) VALUES ('pending@example.test', NULL, 'Pend Ing', 1, 'PEND001')").run();
const r3 = await call('pending@example.test', {});
check('re-signup on a pending row whose email fails -> 202, row kept', r3.status === 202 && r3.body.emailDelayed === true && count('pending@example.test') === 1, JSON.stringify(r3));

// 4) Provider accepts: 201, pending row, hashed token, no password.
globalThis.fetch = async (url, opts) => { globalThis.__sent = JSON.parse(opts.body); return new Response('{"id":"x"}', { status: 200 }); };
const r4 = await call('good@example.test', { RESEND_API_KEY: 'key' });
const row = sqlite.prepare("SELECT * FROM users WHERE email = 'good@example.test'").get();
check('provider accepts -> 201 pendingConfirmation', r4.status === 201 && r4.body.pendingConfirmation === true, JSON.stringify(r4));
check('account is pending with no password and no admin role', row.email_confirmation_pending === 1 && row.password_hash === null && row.role === 'user', JSON.stringify(row));
const link = (globalThis.__sent.text.match(/https:\/\/amicohaus\.com\/verify-email\?token=([0-9a-f]{64})/) || [])[1];
check('email carries a 64-hex link token in text and HTML', !!link && globalThis.__sent.html.includes(link), globalThis.__sent.text);
check('database stores a different value (hash) than the emailed token', row.verify_token && row.verify_token !== link && row.verify_token.length === 64);
check('link expires about 24 hours out', Math.abs(Date.parse(row.verify_token_expires) - Date.now() - 24 * 3600 * 1000) < 60000, row.verify_token_expires);
check('HTML email escapes the name', !globalThis.__sent.html.includes('<script'));
globalThis.fetch = realFetch;

// 5) A hostile display name can't inject markup into the HTML email.
globalThis.fetch = async (url, opts) => { globalThis.__sent = JSON.parse(opts.body); return new Response('{}', { status: 200 }); };
const evil = new Request('https://amicohaus.com/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' }, body: JSON.stringify({ displayName: '<img src=x onerror=alert(1)>', email: 'evil@example.test' }) });
await signup({ request: evil, env: { DB, RESEND_API_KEY: 'key' }, waitUntil() {} });
check('markup in a name is escaped in the HTML email', !globalThis.__sent.html.includes('<img src=x') && globalThis.__sent.html.includes('&lt;img'), globalThis.__sent.html.slice(0, 200));

// 6) Signup intent only steers the link's landing spot; anything unexpected is ignored.
const withIntent = async (email, intent) => {
  globalThis.fetch = async (url, opts) => { globalThis.__sent = JSON.parse(opts.body); return new Response('{}', { status: 200 }); };
  const req = new Request('https://amicohaus.com/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.11' }, body: JSON.stringify({ displayName: 'Intent Person', email, intent }) });
  await signup({ request: req, env: { DB, RESEND_API_KEY: 'key' }, waitUntil() {} });
  return globalThis.__sent.text.match(/verify-email\?token=[0-9a-f]{64}(&as=[a-z]+)?/)[0];
};
check('agent intent is carried in the emailed link', (await withIntent('agent.intent@example.test', 'agent')).endsWith('&as=agent'));
check('homeowner intent is carried in the emailed link', (await withIntent('home.intent@example.test', 'homeowner')).endsWith('&as=homeowner'));
check('an unexpected intent is dropped', !(await withIntent('junk.intent@example.test', '<script>alert(1)</script>')).includes('&as='));
check('no intent means a plain link', !(await withIntent('none.intent@example.test', undefined)).includes('&as='));
globalThis.fetch = realFetch;

// 7) Intent and the ad/video source are stored: first source kept, unknown keys and line breaks dropped.
globalThis.fetch = async () => new Response('{}', { status: 200 });
const withSource = (email, intent, source) => signup({ request: new Request('https://amicohaus.com/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.20' }, body: JSON.stringify({ displayName: 'Source Person', email, intent, source }) }), env: { DB, RESEND_API_KEY: 'key' }, waitUntil() {} });
await withSource('source@example.test', 'agent', { utm_source: 'tiktok\nFAKE', utm_campaign: 'fall', bogus: 'x' });
await withSource('source@example.test', 'homeowner', { utm_source: 'youtube' });
const src = sqlite.prepare("SELECT signup_intent, signup_source FROM users WHERE email = 'source@example.test'").get();
check('signup source is stored, first touch kept, junk and line breaks dropped', src.signup_source === '{"utm_source":"tiktok FAKE","utm_campaign":"fall"}', JSON.stringify(src));
check('the latest signup intent is stored', src.signup_intent === 'homeowner', JSON.stringify(src));

// 8) "Send it again" after a failed send: the 2-minute per-address block is lifted so it can be retried
//    right away, but every try still counts toward the 5-per-hour network limit.
const resend = (await import(pathToFileURL(`${root}/functions/api/auth/resend-confirmation.js`).href)).onRequestPost;
const resendCall = async (email) => {
  const request = new Request('https://amicohaus.com/api/auth/resend-confirmation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.30' }, body: JSON.stringify({ email, intent: 'agent' }) });
  return (await resend({ request, env: { DB, RESEND_API_KEY: 'key' }, waitUntil() {} })).status;
};
globalThis.fetch = async () => new Response('{"message":"nope"}', { status: 422 });
const tries = [];
for (let i = 0; i < 7; i++) tries.push(await resendCall('pending@example.test'));
check('failed resends can be retried right away, then hit the network limit', tries.slice(0, 5).every(s => s === 503) && tries.slice(5).every(s => s === 429), JSON.stringify(tries));
const attempts = (where) => sqlite.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE ip = '203.0.113.30'${where}`).get().n;
check('failed resend attempts stay on record, without the address', attempts('') === 5 && attempts(' AND email IS NOT NULL') === 0, `${attempts('')} rows`);
globalThis.fetch = async () => new Response('{}', { status: 200 });
check('the network limit also blocks a later resend from the same network', (await resendCall('rejected@example.test')) === 429);
globalThis.fetch = realFetch;

// 9) Rudy's "new pre-listing / new agent application" alerts: at most 3 per person and 40 in total a day,
//    counted from a log that deleting a pre-listing can't reset; test and demo accounts never alert.
const { alertAdmin } = await import(pathToFileURL(`${root}/functions/_lib/adminAlerts.js`).href);
const sentAlerts = [];
const alertFor = async (actor) => {
  const pending = [];
  alertAdmin({ env: { DB, RESEND_API_KEY: 'key' }, waitUntil: p => pending.push(p) }, actor, { kind: 'pre_listing', subject: 'New pre-listing', lines: ['x'] });
  await Promise.all(pending);
};
globalThis.fetch = async (url, opts) => { sentAlerts.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); };
for (let i = 0; i < 5; i++) await alertFor({ id: 901, email: 'poster@example.test' });
check('one person gets at most 3 alerts a day', sentAlerts.length === 3, String(sentAlerts.length));
await alertFor({ id: 902, email: 'tester@resend.dev' });
check('test-suite accounts never alert', sentAlerts.length === 3, String(sentAlerts.length));
sqlite.exec("INSERT INTO admin_alerts_sent (user_id, kind) SELECT value + 1000, 'pre_listing' FROM json_each('[" + Array.from({ length: 40 }, (_, i) => i).join(',') + "]')");
await alertFor({ id: 903, email: 'fresh@example.test' });
check('no alerts at all past 40 in a day', sentAlerts.length === 3, String(sentAlerts.length));
check('every alert went to Rudy', sentAlerts.every(m => m.to === 'rudypabloflores@gmail.com'));
globalThis.fetch = realFetch;

console.log = silence;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
