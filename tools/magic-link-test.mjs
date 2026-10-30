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

// 10) The 6-digit code (for people who signed up inside an app's built-in browser).
const verifyCode = (await import(pathToFileURL(`${root}/functions/api/auth/verify-code.js`).href)).onRequestPost;
const codeCall = async (email, code, ip = '203.0.113.40') => {
  const res = await verifyCode({ request: new Request('https://amicohaus.com/api/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ email, code }) }), env: { DB, RESEND_API_KEY: 'key' }, waitUntil() {} });
  return { status: res.status, body: await res.json() };
};
const signupAs = (email, ip, extra = {}) => signup({ request: new Request('https://amicohaus.com/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ displayName: 'Code Person', email, ...extra }) }), env: { DB, RESEND_API_KEY: 'key' }, waitUntil() {} });
const sentCode = () => globalThis.__sent.text.match(/instead: (\d{3}) (\d{3})/).slice(1).join('');
globalThis.fetch = async (url, opts) => { globalThis.__sent = JSON.parse(opts.body); return new Response('{}', { status: 200 }); };
await signup({ request: new Request('https://amicohaus.com/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.41' }, body: JSON.stringify({ displayName: 'Code Person', email: 'code@example.test', intent: 'agent' }) }), env: { DB, RESEND_API_KEY: 'key' }, waitUntil() {} });
const codeMatch = globalThis.__sent.text.match(/code on the sign-up page instead: (\d{3}) (\d{3})/);
check('the confirmation email carries a 6-digit code', !!codeMatch && globalThis.__sent.html.includes(`${codeMatch[1]} ${codeMatch[2]}`), globalThis.__sent.text);
const goodCode = codeMatch ? codeMatch[1] + codeMatch[2] : '000000';
const badCode = goodCode === '111111' ? '222222' : '111111';
let cr = await codeCall('code@example.test', badCode);
check('a wrong code is refused', cr.status === 400 && /didn't match/.test(cr.body.error), JSON.stringify(cr));
cr = await codeCall('nobody@example.test', goodCode);
check('an unknown address gets the same answer (no account lookup)', cr.status === 400 && /didn't match/.test(cr.body.error));
cr = await codeCall('code@example.test', `${goodCode.slice(0, 3)} ${goodCode.slice(3)}`, '203.0.113.42');
check('the right code (spaces are fine) returns a one-time link token and the agent path', cr.status === 200 && /^[0-9a-f]{64}$/.test(cr.body.token) && cr.body.as === 'agent', JSON.stringify(cr));
const verifyEmail = (await import(pathToFileURL(`${root}/functions/api/auth/verify-email.js`).href));
const peek = await verifyEmail.onRequestGet({ request: new Request(`https://amicohaus.com/api/auth/verify-email?token=${cr.body.token}`), env: { DB } });
check('...which opens the usual choose-a-password screen', peek.status === 200 && (await peek.json()).email === 'code@example.test');
cr = await codeCall('code@example.test', goodCode, '203.0.113.43');
check('a code works only once', cr.status === 400);
// Brute force: 5 wrong tries kill the code, even from different networks.
await signup({ request: new Request('https://amicohaus.com/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.44' }, body: JSON.stringify({ displayName: 'Guess Target', email: 'guess@example.test' }) }), env: { DB, RESEND_API_KEY: 'key' }, waitUntil() {} });
const realCode = globalThis.__sent.text.match(/instead: (\d{3}) (\d{3})/).slice(1).join('');
const wrong = realCode === '333333' ? '444444' : '333333';
for (let i = 0; i < 5; i++) await codeCall('guess@example.test', wrong, `198.51.100.${i + 1}`);
cr = await codeCall('guess@example.test', realCode, '198.51.100.99');
check('after 5 wrong tries the code stops working, even the right one', cr.status === 400 && /didn't match/.test(cr.body.error), JSON.stringify(cr));
const guessTries = [];
for (let i = 0; i < 9; i++) guessTries.push((await codeCall('nobody2@example.test', '123456', '198.51.100.200')).status);
check('one network guessing many addresses hits the login limit', guessTries.includes(429), JSON.stringify(guessTries));

// A burst of parallel guesses (under the per-address cap): each spends an attempt before it's compared, so at most 5
// are ever compared. (A bigger burst is refused outright: every try is recorded before any is counted.)
await signupAs('burst@example.test', '203.0.113.50');
const burstCode = sentCode();
const burstWrong = burstCode === '555555' ? '666666' : '555555';
await Promise.all(Array.from({ length: 9 }, (_, i) => codeCall('burst@example.test', burstWrong, `192.0.2.${i + 1}`)));
const burstRow = sqlite.prepare("SELECT verify_code_attempts FROM users WHERE email = 'burst@example.test'").get();
check('9 parallel wrong guesses spend exactly the 5 attempts', burstRow.verify_code_attempts === 5, JSON.stringify(burstRow));
cr = await codeCall('burst@example.test', burstCode, '192.0.2.99');
check('...and the right code is refused afterwards', cr.status === 400, JSON.stringify(cr));

// The stored value is keyed with a server secret: a plain hash of "id:code" doesn't match it.
const { hashToken } = await import(pathToFileURL(`${root}/functions/_lib/auth.js`).href);
const keyedRow = sqlite.prepare("SELECT id, verify_code_hash FROM users WHERE email = 'burst@example.test'").get();
check('the stored code is an HMAC, not a plain hash', keyedRow.verify_code_hash && keyedRow.verify_code_hash !== await hashToken(`${keyedRow.id}:${burstCode}`));

// Signing up again with the same pending address within 2 minutes doesn't send another email.
let sends = 0;
globalThis.fetch = async (url, opts) => { sends++; globalThis.__sent = JSON.parse(opts.body); return new Response('{}', { status: 200 }); };
await signupAs('twice@example.test', '203.0.113.51');
const again = await signupAs('twice@example.test', '203.0.113.52');
check('a repeat signup within 2 minutes sends no second email (and still shows check-your-email)', sends === 1 && again.status === 201, `sends=${sends} status=${again.status}`);

// ...but a send that failed never starts that wait: signing up again right away tries again.
sends = 0;
globalThis.fetch = async () => new Response('{"message":"down"}', { status: 500 });
const failedFirst = await signupAs('retry@example.test', '203.0.113.53');
globalThis.fetch = async (url, opts) => { sends++; globalThis.__sent = JSON.parse(opts.body); return new Response('{}', { status: 200 }); };
const retried = await signupAs('retry@example.test', '203.0.113.54');
check('after a failed send, signing up again right away sends the email', failedFirst.status === 202 && retried.status === 201 && sends === 1, `first=${failedFirst.status} retry=${retried.status} sends=${sends}`);

// Per address: 10 code tries a day across every code sent, then only the emailed link works.
const { sendConfirmationLink } = await import(pathToFileURL(`${root}/functions/_lib/emailConfirmation.js`).href);
const capUser = sqlite.prepare("SELECT id, email, display_name FROM users WHERE email = 'twice@example.test'").get();
const resendCtx = { env: { DB, RESEND_API_KEY: 'key' }, request: new Request('https://amicohaus.com/x') };
for (let i = 0; i < 5; i++) await codeCall('twice@example.test', '000001', `192.0.2.${100 + i}`);
await sendConfirmationLink(resendCtx, { id: capUser.id, email: capUser.email, displayName: capUser.display_name });
for (let i = 0; i < 5; i++) await codeCall('twice@example.test', '000001', `192.0.2.${110 + i}`);
await sendConfirmationLink(resendCtx, { id: capUser.id, email: capUser.email, displayName: capUser.display_name });
cr = await codeCall('twice@example.test', sentCode(), '192.0.2.120');
check('after 10 tries in a day, even a fresh right code is refused on that address', cr.status === 400 && /Too many tries on this address/.test(cr.body.error), JSON.stringify(cr));
globalThis.fetch = realFetch;

console.log = silence;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
