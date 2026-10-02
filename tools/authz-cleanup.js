// Removes everything authz_test.js created: its R2 photos, its users (cascades to their rows), and my own signup throttle rows.
// Usage: [MY_IP=<your ip>] node tools/authz-cleanup.js <projectRoot>
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2];
const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'authz-cleanup.json'), 'utf8'));

const run = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });

for (const key of info.r2keys) {
  try { run(`npx wrangler r2 object delete amicohaus-photos/${key} --remote`); console.log('deleted R2 object', key); }
  catch (e) { console.log('R2 delete failed for', key, String(e.stderr || e.message).slice(0, 120)); }
}

const ids = info.userIds.join(',');
const file = path.join(__dirname, 'authz-cleanup.sql');
fs.writeFileSync(file, [
  `DELETE FROM users WHERE id IN (${ids}) AND email LIKE 'delivered+authz-%@resend.dev';`,
  // Signups are limited to 5 per IP per hour and every attempt counts, so a second run needs these cleared.
  // Set MY_IP to the address you run this from (the `ip` column in login_attempts).
  ...(process.env.MY_IP ? [`DELETE FROM login_attempts WHERE kind = 'signup' AND ip = '${process.env.MY_IP}' AND created_at > datetime('now', '-3 hours');`] : []),
].join('\n') + '\n');
const out = run(`npx wrangler d1 execute amicohaus --remote --file "${file}"`);
console.log((out.match(/"changes": \d+/g) || []).join(', '));

const left = JSON.parse(run(`npx wrangler d1 execute amicohaus --remote --json --command "SELECT (SELECT COUNT(*) FROM users WHERE email LIKE 'test-%') AS test_users, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM agent_profiles WHERE status='approved') AS approved_agents"`).replace(/^[^\[]*/, ''))[0].results[0];
console.log('after cleanup:', JSON.stringify(left));
