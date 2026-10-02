// Creates one throwaway, already-confirmed account on production and prints a session cookie for it, so a
// script that needs a signed-in user (e.g. an API sweep) can run. Signing up now only creates a pending account
// and emails a link, so this plants a known link token and follows the real confirm endpoint with it.
//
//   node tools/make-test-session.js <projectRoot>            -> prints the cookie
//   node tools/make-test-session.js <projectRoot> --delete   -> deletes every account this script made
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT = process.argv[2];
const BASE = 'https://amicohaus.com';
const PATTERN = 'delivered+session-%@resend.dev'; // Resend's test inbox: real sends are accepted, nobody receives them

const sql = (command) => JSON.parse(execSync(`npx wrangler d1 execute amicohaus --remote --json --command "${command.replace(/"/g, '\\"')}"`,
  { cwd: ROOT, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).replace(/^[^\[]*/, ''))[0].results || [];

(async () => {
  if (process.argv.includes('--delete')) {
    sql(`DELETE FROM users WHERE email LIKE '${PATTERN}'`);
    console.error('deleted test-session accounts');
    return;
  }
  const email = `delivered+session-${crypto.randomBytes(4).toString('hex')}@resend.dev`;
  const password = 'Session-' + crypto.randomBytes(8).toString('hex') + '!';
  const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const signup = await post('/api/auth/signup', { email, displayName: 'Test Session' });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);

  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  sql(`UPDATE users SET verify_token = '${hash}', verify_token_expires = '${new Date(Date.now() + 3600e3).toISOString()}' WHERE email = '${email}'`);

  const confirm = await post('/api/auth/verify-email', { token, password });
  if (confirm.status !== 200) throw new Error(`confirm failed: ${confirm.status} ${await confirm.text()}`);
  const cookie = /^ah_session=[^;]+/.exec((confirm.headers.getSetCookie() || []).find(c => c.startsWith('ah_session=')) || '');
  if (!cookie) throw new Error('no session cookie came back');
  console.log(cookie[0]);
})().catch(e => { console.error(String(e.message || e)); process.exit(1); });
