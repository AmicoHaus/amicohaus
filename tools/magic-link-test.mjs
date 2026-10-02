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

// 1) No email provider configured: signup must fail loudly and leave nothing behind.
const r1 = await call('new.person@example.test', {});
check('unavailable email -> 503 with a clear message', r1.status === 503 && /couldn.t send/i.test(r1.body.error), JSON.stringify(r1));
check('...and no half-made account is left', count('new.person@example.test') === 0);

// 2) Provider rejects the send (like Resend returning an error).
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{"message":"nope"}', { status: 422 });
const r2 = await call('rejected@example.test', { RESEND_API_KEY: 'key' });
check('provider rejects the send -> 503, nothing left', r2.status === 503 && count('rejected@example.test') === 0, JSON.stringify(r2));

// 3) A pending account whose re-send fails is kept (it already existed), but the caller is told.
sqlite.prepare("INSERT INTO users (email, password_hash, display_name, email_confirmation_pending, referral_code) VALUES ('pending@example.test', NULL, 'Pend Ing', 1, 'PEND001')").run();
const r3 = await call('pending@example.test', {});
check('re-signup on a pending row whose email fails -> 503, row kept', r3.status === 503 && count('pending@example.test') === 1, JSON.stringify(r3));

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

console.log = silence;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
