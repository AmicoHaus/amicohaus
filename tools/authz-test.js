// Two-user authorization test against production. Creates throwaway test-authz-* accounts, plants recognisable
// secrets in user A's data, then tries to read / change it as other users and anonymously.
// Usage: node tools/authz-test.js <projectRoot>   then: node tools/authz-cleanup.js <projectRoot>
// Needs wrangler logged in (it seeds two approved agents with SQL). Uses 5 signups, the hourly per-IP limit.
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const BASE = 'https://amicohaus.com';
const RUN = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'AuthzTest-' + Math.random().toString(36).slice(2, 12) + '!';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const MARK = {
  clientName: 'SECRETCLIENT' + RUN,
  address: '123 SECRETADDR' + RUN + ' St',
  preAddress: '456 HIDDENADDR' + RUN + ' Ave',
  lockbox: 'LOCKBOXCODE' + RUN,
  message: 'PRIVATEMSG' + RUN,
  comment: 'AUTHZCOMMENT' + RUN,
  augAddress: '789 ADAPTADDR' + RUN + ' Way',
  projAddress: '321 PROJADDR' + RUN + ' Blvd',
  // Deliberately distinct from MARK.message: B legitimately owns this one (it's B's own offer message, read
  // back via B's own GET), so it can't share a value with the A<->C conversation secret B must never see.
  offerMessage: 'OFFERMSG' + RUN,
  greenAddress: '654 GREENADDR' + RUN + ' Ct',
  // The owner's counter-offer message to B -- B legitimately reads this back (it's addressed to them), but a
  // stranger (C) or anonymous must never see it, same reasoning as offerMessage above.
  counterMessage: 'COUNTERMSG' + RUN,
};

const results = [];
const findings = [];
function record(section, label, ok, detail = '') {
  results.push({ section, label, ok, detail });
  if (!ok) findings.push(`[${section}] ${label}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${label}${ok ? '' : '  <<< ' + detail}`);
}

function sql(command) {
  const out = execSync(`npx wrangler d1 execute amicohaus --remote --json --command "${command.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true, maxBuffer: 20 * 1024 * 1024 });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  return j[0].results || [];
}

class User {
  constructor(role) { this.role = role; this.cookie = ''; this.id = null; this.email = `delivered+authz-${role}-${RUN}@resend.dev`; }
  async call(method, url, body, opts = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    let payload;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try { res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
    catch (e) { throw new Error(`${method} ${url} failed: ${e.name} ${e.message}`); } // say WHICH request, not just "timeout"
    const text = res.headers.get('content-type')?.startsWith('image/') ? '' : await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) { const m = /^ah_session=([^;]*)/.exec(c); if (m) this.cookie = m[1] ? `ah_session=${m[1]}` : ''; }
    return { status: res.status, json, text };
  }
  // Signing up now only creates a pending account and emails a link. The real link's token exists only in the
  // email, so the test plants a known token's hash and follows the real confirm endpoint with it.
  async signup(extra = {}) {
    const r = await this.call('POST', '/api/auth/signup', { email: this.email, displayName: `Authz ${this.role}`, ...extra });
    if (r.status !== 201 || !r.json.pendingConfirmation) throw new Error(`signup ${this.role} failed: ${r.status} ${r.text.slice(0, 150)}`);
    this.id = sql(`SELECT id FROM users WHERE email = '${this.email}'`)[0].id;
    return r;
  }
  async confirm() {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    sql(`UPDATE users SET verify_token = '${hash}', verify_token_expires = '${new Date(Date.now() + 3600e3).toISOString()}' WHERE id = ${this.id}`);
    const r = await this.call('POST', '/api/auth/verify-email', { token, password: PASSWORD });
    if (r.status !== 200) throw new Error(`confirm ${this.role} failed: ${r.status} ${r.text.slice(0, 150)}`);
    return r;
  }
}
const anon = new User('anon');

// Records every account this run made (matched by its own email pattern) plus their R2 photos, for authz-cleanup.js.
// Called at the end AND when the run crashes, so an aborted run can still be cleaned up.
function writeCleanupFile() {
  const ids = sql(`SELECT id FROM users WHERE email LIKE 'delivered+authz-%-${RUN}@resend.dev'`).map(r => r.id);
  if (!ids.length) return 0;
  const list = ids.join(',');
  const r2keys = sql(`SELECT r2_key FROM pre_listing_photos WHERE pre_listing_id IN (SELECT id FROM pre_listings WHERE user_id IN (${list})) UNION SELECT r2_key FROM listing_photos WHERE listing_id IN (SELECT id FROM listings WHERE user_id IN (${list}))`).map(r => r.r2_key);
  fs.writeFileSync(path.join(__dirname, 'authz-cleanup.json'), JSON.stringify({ run: RUN, userIds: ids, r2keys }));
  return ids.length;
}

// Any 4xx counts as "refused" — some handlers answer a non-party with 400 ("You are not a party…") rather than 403.
// What must never happen is a 2xx, and the follow-up state checks below catch anything that slipped through.
const denied = r => r.status >= 400 && r.status < 500;

(async () => {
  const A = new User('homeowner'), B = new User('attacker'), C = new User('partner'), G = new User('agent1'), H = new User('agent2');

  // ---------- setup ----------
  console.log('== setup ==');
  await A.signup(); await C.signup(); await G.signup(); await H.signup();
  // B signs up with privilege-escalation fields in the body.
  const bSignup = await B.signup({ role: 'admin', isAdmin: true, is_verified: 1, isVerified: true, password: PASSWORD });
  console.log('users', { A: A.id, B: B.id, C: C.id, G: G.id, H: H.id });

  // Magic-link signup: until the emailed link is used the account is inert.
  record('signup', 'signup response issues no session cookie', B.cookie === '' && !('user' in bSignup.json), JSON.stringify(bSignup.json));
  const pendingLogin = await B.call('POST', '/api/auth/login', { email: B.email, password: PASSWORD });
  record('signup', 'a pending account cannot log in (even with the password sent at signup)', pendingLogin.status === 403 && pendingLogin.json.code === 'email_unconfirmed', `status ${pendingLogin.status}`);
  const pendingRow = sql(`SELECT password_hash, email_confirmation_pending AS pending, verify_token FROM users WHERE id = ${B.id}`)[0];
  record('signup', 'a pending account has no password and no usable token stored in the clear', pendingRow.password_hash === null && pendingRow.pending === 1 && /^[0-9a-f]{64}$/.test(pendingRow.verify_token), JSON.stringify(pendingRow).slice(0, 120));
  const noPw = await anon.call('POST', '/api/auth/verify-email', { token: 'x'.repeat(64) });
  record('signup', 'a made-up link token is refused', noPw.status === 400 && noPw.json.code === 'invalid', `status ${noPw.status}`);
  for (const u of [A, B, C, G, H]) await u.confirm();
  const reuse = await anon.call('POST', '/api/auth/verify-email', { token: 'reused', password: PASSWORD });
  record('signup', 'confirming gives a working session', (await B.call('GET', '/api/me')).status === 200, '');
  const bAfter = sql(`SELECT role, email_confirmation_pending AS pending, verify_token FROM users WHERE id = ${B.id}`)[0];
  record('privilege', 'signup ignores role/isAdmin/isVerified in the body', bAfter.role === 'user' && bAfter.pending === 0 && bAfter.verify_token === null, JSON.stringify(bAfter));
  const bDb = sql(`SELECT role, is_verified FROM users WHERE id = ${B.id}`)[0];
  record('privilege', 'attacker row in DB is role=user, unverified', bDb.role === 'user' && !bDb.is_verified, JSON.stringify(bDb));

  sql(`INSERT INTO agent_profiles (user_id, status, brokerage_name, license_number, years_experience, bio) VALUES (${G.id}, 'approved', 'Authz Realty One', 'TESTLIC-1', 5, 'bio'), (${H.id}, 'approved', 'Authz Realty Two', 'TESTLIC-2', 6, 'bio')`);

  const listingBody = (over) => ({ title: 'AUTHZ Home', city: 'San Diego', state: 'CA', propertyType: 'Single Family Home', beds: 3, baths: 2, estimatedValue: 600000,
    address: MARK.address, clientName: MARK.clientName, description: 'authz test', locations: 'Sacramento, CA', desiredType: 'Condo', priceMin: 500000, priceMax: 700000,
    minBeds: 1, minBaths: 1, cashMode: 'none', ...over });
  const la = await A.call('POST', '/api/listings', listingBody());
  const LA = la.json && la.json.id;
  const lc = await C.call('POST', '/api/listings', listingBody({ title: 'AUTHZ Partner Home', city: 'Sacramento', propertyType: 'Condo', locations: 'San Diego, CA', desiredType: 'Single Family Home', address: '', clientName: '' }));
  const LC = lc.json && lc.json.id;
  console.log('listings', { LA, LC, laStatus: la.status, lcStatus: lc.status });

  const ph = new FormData(); ph.append('photo', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const laPhoto = await A.call('POST', `/api/listings/${LA}/photos`, undefined, { form: ph });
  const LA_PHOTO = laPhoto.json && laPhoto.json.id;

  const post = await A.call('POST', '/api/posts', { body: 'AUTHZ post by A' });
  const P = post.json && post.json.id;
  const cm = await C.call('POST', `/api/posts/${P}/comments`, { body: MARK.comment });
  const CM = cm.json && cm.json.id;
  const conv = await A.call('POST', '/api/conversations', { userId: C.id });
  const K = conv.json && conv.json.id;
  await A.call('POST', `/api/conversations/${K}/messages`, { body: MARK.message });
  const ss = await A.call('POST', '/api/saved-searches', { locations: 'San Diego', propertyType: 'Any' });
  const SS = ss.json && ss.json.id;
  const al = await A.call('POST', '/api/agent-search-alerts', { label: 'authz alert', filters: { minRating: 4 } });
  const AL = al.json && al.json.id;

  const pl = await A.call('POST', '/api/pre-listings', { title: 'AUTHZ Pre', askingPrice: 750000, city: 'San Diego', state: 'CA', zip: '92104', neighborhood: 'North Park', address: MARK.preAddress,
    propertyType: 'Single Family Home', beds: 3, baths: 2, description: 'authz pre', occupancyStatus: 'occupied', showingNoticeHours: 24, specialInstructions: MARK.lockbox });
  const PL = pl.json && pl.json.id;
  const plPhotoForm = new FormData(); plPhotoForm.append('photo', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const plPhoto = await A.call('POST', `/api/pre-listings/${PL}/photos`, undefined, { form: plPhotoForm });
  const PLPHOTO = plPhoto.json && plPhoto.json.id;
  // A second pre-listing that stays open: the first one is awarded during setup, and awarded ones take no more price votes.
  const PL2_BODY = { title: 'AUTHZ Pre 2', askingPrice: 750000, city: 'San Diego', state: 'CA', zip: '92104', neighborhood: 'North Park', address: MARK.preAddress,
    propertyType: 'Single Family Home', beds: 3, baths: 2, description: 'authz pre 2', occupancyStatus: 'occupied', showingNoticeHours: 24, specialInstructions: MARK.lockbox };
  const PL2 = ((await A.call('POST', '/api/pre-listings', PL2_BODY)).json || {}).id;

  const tx = await A.call('POST', '/api/transactions', { listingIdA: LA, listingIdB: LC, note: 'authz swap' });
  const T = tx.json && tx.json.id;
  console.log('resources', { P, CM, K, SS, AL, PL, PLPHOTO, T, txStatus: tx.status, txErr: tx.status !== 201 ? tx.text.slice(0, 120) : '' });

  const bidBody = { message: 'AUTHZ bid', commissionPct: 2, flatFee: 500, services: [{ type: 'photography' }], turnaroundDays: 3 };
  const gBid = await G.call('POST', `/api/pre-listings/${PL}/bids`, bidBody);
  const hBid = await H.call('POST', `/api/pre-listings/${PL}/bids`, { ...bidBody, message: 'AUTHZ bid H' });
  console.log('bids', { g: gBid.status, h: hBid.status, gErr: gBid.status !== 201 ? gBid.text.slice(0, 140) : '' });
  const plAsA = await A.call('GET', `/api/pre-listings/${PL}`);
  const bids = (plAsA.json && plAsA.json.bids) || [];
  const GBID = (bids.find(b => b.agentUserId === G.id) || {}).id;
  const HBID = (bids.find(b => b.agentUserId === H.id) || {}).id;
  let TG = null, TH = null;
  if (T) {
    const tg = await G.call('POST', `/api/transactions/${T}/bids`, bidBody); TG = tg.status;
    const th = await H.call('POST', `/api/transactions/${T}/bids`, { ...bidBody, message: 'AUTHZ tx bid H' }); TH = th.status;
  }
  const txAsA = T ? await A.call('GET', `/api/transactions/${T}`) : null;
  const tbids = (txAsA && txAsA.json && txAsA.json.bids) || [];
  const TGBID = (tbids.find(b => b.agentUserId === G.id) || {}).id;
  const THBID = (tbids.find(b => b.agentUserId === H.id) || {}).id;
  console.log('bid ids', { GBID, HBID, TGBID, THBID, TG, TH });

  // Award G on the pre-listing so milestones exist.
  const acc = await A.call('PUT', `/api/pre-listings/${PL}/bids/${GBID}`, { action: 'accept' });
  record('setup', 'owner can accept a proposal on their own pre-listing', acc.status === 200, `status ${acc.status}`);

  // ---------- 1. anonymous ----------
  console.log('\n== anonymous ==');
  for (const [label, url] of [
    ['pre-listing browse', '/api/pre-listings'], ['pre-listing detail', `/api/pre-listings/${PL}`], ['pre-listing photo list', `/api/pre-listings/${PL}/photos`],
    ['pre-listing photo file', `/api/pre-listing-photos/${PLPHOTO}`], ['pre-listing votes', `/api/pre-listings/${PL}/votes`],
    ['transaction list', '/api/transactions'], ['transaction detail', `/api/transactions/${T}`], ['conversation list', '/api/conversations'],
    ['license photo', `/api/license-photos/${G.id}`], ['account export', '/api/account/export'], ['admin overview', '/api/admin/overview'],
  ]) {
    const r = await anon.call('GET', url);
    record('anonymous', `${label} requires sign-in`, r.status === 401, `status ${r.status}`);
  }
  const anonListing = await anon.call('GET', `/api/listings/${LA}`);
  const al_ = anonListing.json && anonListing.json.listing || {};
  // The feed, its comments and groups are public by design (the feed handler explicitly serves anonymous viewers).
  for (const [label, url] of [['post comments', `/api/posts/${P}/comments`], ['groups list', '/api/groups'], ['posts feed', '/api/posts']]) {
    const r = await anon.call('GET', url);
    record('anonymous', `${label} stay publicly readable (by design)`, r.status === 200, `status ${r.status}`);
  }
  record('anonymous', 'listing detail hides address, client name and views',anonListing.status === 200 && !('address' in al_) && !('client_name' in al_) && !('views' in al_), JSON.stringify(Object.keys(al_)).slice(0, 200));
  const anonUser = await anon.call('GET', `/api/users/${A.id}`);
  record('anonymous', 'public profile does not expose email or password hash', !/@example\.com|password|hash/i.test(anonUser.text), anonUser.text.slice(0, 120));
  const anonAgent = await anon.call('GET', `/api/agents/${G.id}`);
  const ap = anonAgent.json && anonAgent.json.profile || {};
  record('anonymous', 'public agent profile leaves out internal fields', anonAgent.status === 200 && !('notifyNewRequests' in ap) && !('rejectionReason' in ap) && !('appliedAt' in ap) && !('reviewedAt' in ap), JSON.stringify(Object.keys(ap)).slice(0, 220));

  // ---------- 1b. the live site and the demo stay separate ----------
  console.log('\n== live vs demo ==');
  const DEMO = "'%@demo.amicohaus.local'";
  const demoListingIds = new Set(sql(`SELECT id FROM listings WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${DEMO})`).map(r => r.id));
  if (demoListingIds.size) {
    const someDemo = [...demoListingIds][0];
    record('separation', 'a demo listing has no public page', (await anon.call('GET', `/listing/${someDemo}`)).status === 404, '');
    record('separation', 'a demo listing has no public API detail', (await anon.call('GET', `/api/listings/${someDemo}`)).status === 404, '');
    record('separation', 'a demo listing has no API detail for a signed-in user either', (await A.call('GET', `/api/listings/${someDemo}`)).status === 404, '');
    const dir = await anon.call('GET', '/api/directory?limit=100');
    record('separation', 'the live directory contains no demo listing', dir.status === 200 && !dir.json.listings.some(l => demoListingIds.has(l.id)), '');
    const sm = await anon.call('GET', '/sitemap.xml');
    record('separation', 'the sitemap lists no demo listing', ![...demoListingIds].some(id => sm.text.includes(`/listing/${id}<`)), '');
  } else console.log('  (no demo listings in this database — skipping demo-listing checks)');
  const stats = await anon.call('GET', '/api/public-stats');
  const truth = sql(`SELECT (SELECT COUNT(*) FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id WHERE agent_profiles.status = 'approved' AND users.email NOT LIKE ${DEMO}) AS agents, (SELECT COUNT(*) FROM pre_listings JOIN users ON users.id = pre_listings.user_id WHERE pre_listings.status = 'open' AND users.email NOT LIKE ${DEMO}) + (SELECT COUNT(*) FROM transaction_requests JOIN users ON users.id = transaction_requests.user_a_id WHERE transaction_requests.status = 'open' AND users.email NOT LIKE ${DEMO}) AS requests, (SELECT COUNT(*) FROM listings JOIN users ON users.id = listings.user_id WHERE listings.status = 'active' AND listings.is_buyer_only = 0 AND users.email NOT LIKE ${DEMO} AND listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)) AS listings`)[0];
  record('separation', 'public stats are counts only and match the database exactly (demo excluded)', stats.status === 200 && Object.keys(stats.json).sort().join() === 'agents,listings,openRequests' && stats.json.agents === truth.agents && stats.json.openRequests === truth.requests && stats.json.listings === truth.listings, JSON.stringify(stats.json) + ' vs ' + JSON.stringify(truth));
  const home = await anon.call('GET', '/');
  record('separation', 'the home page ships no demo data or fictional agents', !home.text.includes('demo-sample-data.js') && !/Marisol Vega|Devon Brooks|Priya Nair|Tom Alvarez/.test(home.text), '');
  const demoPage = await anon.call('GET', '/demo');
  record('separation', 'the demo page is still the home of the fictional samples', demoPage.text.includes('demo-sample-data.js'), '');

  // ---------- 2. attacker B (ordinary signed-in user) ----------
  console.log('\n== attacker (signed-in, not a party) ==');
  const chk = async (section, label, method, url, body) => { const r = await B.call(method, url, body); record(section, label, denied(r), `status ${r.status} ${r.text.slice(0, 90)}`); return r; };
  await chk('listings', 'cannot edit another user\'s listing', 'PUT', `/api/listings/${LA}`, { action: 'edit', ...listingBody({ title: 'HACKED' }) });
  await chk('listings', 'cannot pause another user\'s listing', 'PUT', `/api/listings/${LA}`, { action: 'pause' });
  await chk('listings', 'cannot delete another user\'s listing', 'DELETE', `/api/listings/${LA}`);
  { const f = new FormData(); f.append('photo', new Blob([PNG], { type: 'image/png' }), 'x.png'); const r = await B.call('POST', `/api/listings/${LA}/photos`, undefined, { form: f }); record('listings', 'cannot add photos to another user\'s listing', denied(r), `status ${r.status}`); }
  if (LA_PHOTO) await chk('listings', 'cannot delete another user\'s listing photo', 'DELETE', `/api/listings/${LA}/photos/${LA_PHOTO}`);
  const aAfter = await A.call('GET', `/api/listings/${LA}`);
  record('listings', 'listing is untouched after the attempts', aAfter.json && aAfter.json.listing && aAfter.json.listing.title === 'AUTHZ Home' && aAfter.json.listing.status === 'active', JSON.stringify(aAfter.json && aAfter.json.listing && { t: aAfter.json.listing.title, s: aAfter.json.listing.status }));
  const bListing = await B.call('GET', `/api/listings/${LA}`);
  const bl = bListing.json && bListing.json.listing || {};
  record('listings', 'listing detail hides address, client name and views from B', !('address' in bl) && !('client_name' in bl) && !('views' in bl), JSON.stringify(Object.keys(bl)).slice(0, 150));
  const aOwn = await A.call('GET', `/api/listings/${LA}`);
  record('listings', 'owner still sees address and client name', aOwn.json.listing.address === MARK.address && aOwn.json.listing.client_name === MARK.clientName, '');

  await chk('posts', 'cannot delete another user\'s post', 'DELETE', `/api/posts/${P}`);
  await chk('posts', 'cannot delete another user\'s comment', 'DELETE', `/api/comments/${CM}`);
  const pStill = await A.call('GET', `/api/posts/${P}/comments`);
  record('posts', 'comment still there', pStill.text.includes(MARK.comment), '');

  await chk('messages', 'cannot read a conversation B isn\'t in', 'GET', `/api/conversations/${K}/messages`);
  await chk('messages', 'cannot post into a conversation B isn\'t in', 'POST', `/api/conversations/${K}/messages`, { body: 'intrusion' });
  const bConvos = await B.call('GET', '/api/conversations');
  record('messages', 'conversation list does not include A↔C thread', !JSON.stringify(bConvos.json).includes(MARK.message) && (bConvos.json.conversations || []).length === 0, bConvos.text.slice(0, 100));

  await B.call('DELETE', `/api/saved-searches/${SS}`);
  const ssStill = await A.call('GET', '/api/saved-searches');
  record('saved-searches', 'B cannot delete A\'s saved search', (ssStill.json.searches || []).some(s => s.id === SS), '');
  await B.call('DELETE', `/api/agent-search-alerts/${AL}`);
  const alStill = await A.call('GET', '/api/agent-search-alerts');
  record('saved-searches', 'B cannot delete A\'s agent alert', (alStill.json.alerts || []).some(a => a.id === AL), '');

  const bPl = await B.call('GET', `/api/pre-listings/${PL}`);
  const bp = bPl.json && bPl.json.preListing || {};
  record('pre-listing', 'B can browse a pre-listing but not its address or lockbox notes', bPl.status === 200 && !('address' in bp) && bp.specialInstructions === undefined && !bPl.text.includes(MARK.preAddress) && !bPl.text.includes(MARK.lockbox), `status ${bPl.status} keys=${Object.keys(bp).join(',').slice(0, 120)}`);
  record('pre-listing', 'B sees no proposals', bPl.json && bPl.json.bids === null, JSON.stringify(bPl.json && bPl.json.bids).slice(0, 80));
  await chk('pre-listing', 'cannot edit', 'PUT', `/api/pre-listings/${PL}`, { action: 'close' });
  await chk('pre-listing', 'cannot delete', 'DELETE', `/api/pre-listings/${PL}`);
  await chk('pre-listing', 'cannot accept a proposal', 'PUT', `/api/pre-listings/${PL}/bids/${HBID}`, { action: 'accept' });
  await chk('pre-listing', 'cannot withdraw someone else\'s proposal', 'PUT', `/api/pre-listings/${PL}/bids/${GBID}`, { action: 'withdraw' });
  await chk('pre-listing', 'non-agent cannot submit a proposal', 'POST', `/api/pre-listings/${PL}/bids`, bidBody);
  await chk('pre-listing', 'non-agent cannot vote', 'POST', `/api/pre-listings/${PL}/votes`, { vote: 'too_high' });
  await chk('pre-listing', 'cannot invite agents', 'POST', `/api/pre-listings/${PL}/invites`, { agentUserId: H.id });
  { const f = new FormData(); f.append('photo', new Blob([PNG], { type: 'image/png' }), 'x.png'); const r = await B.call('POST', `/api/pre-listings/${PL}/photos`, undefined, { form: f }); record('pre-listing', 'cannot add photos', denied(r), `status ${r.status}`); }
  await chk('pre-listing', 'cannot read the milestone checklist', 'GET', `/api/pre-listings/${PL}/milestones`);
  await chk('pre-listing', 'cannot add a milestone', 'POST', `/api/pre-listings/${PL}/milestones`, { label: 'x' });
  await chk('pre-listing', 'cannot raise a dispute', 'POST', `/api/pre-listings/${PL}/disputes`, { reason: 'x', description: 'x' });
  await chk('pre-listing', 'cannot leave a review', 'POST', `/api/pre-listings/${PL}/review`, { rating: 1, comment: 'x' });
  await chk('pre-listing', 'cannot review the homeowner', 'POST', `/api/pre-listings/${PL}/review-homeowner`, { rating: 1, comment: 'x' });
  const bPhoto = await B.call('GET', `/api/pre-listing-photos/${PLPHOTO}`);
  record('pre-listing', 'signed-in user can load a pre-listing photo (in-app use)', bPhoto.status === 200, `status ${bPhoto.status}`);

  if (T) {
    const bTx = await B.call('GET', `/api/transactions/${T}`);
    record('transaction', 'B sees no proposals on someone else\'s trade', bTx.json && bTx.json.bids === null && bTx.json.isParty === false, JSON.stringify(bTx.json && { bids: bTx.json.bids, isParty: bTx.json.isParty }));
    await chk('transaction', 'cannot accept a proposal', 'PUT', `/api/transactions/${T}/bids/${THBID}`, { action: 'accept' });
    await chk('transaction', 'cannot withdraw another agent\'s proposal', 'PUT', `/api/transactions/${T}/bids/${TGBID}`, { action: 'withdraw' });
    await chk('transaction', 'non-agent cannot bid', 'POST', `/api/transactions/${T}/bids`, bidBody);
    await chk('transaction', 'cannot read milestones', 'GET', `/api/transactions/${T}/milestones`);
    await chk('transaction', 'cannot add a milestone', 'POST', `/api/transactions/${T}/milestones`, { label: 'x' });
    await chk('transaction', 'cannot raise a dispute', 'POST', `/api/transactions/${T}/disputes`, { reason: 'x', description: 'x' });
    await chk('transaction', 'cannot invite agents', 'POST', `/api/transactions/${T}/invites`, { agentUserId: H.id });
    await chk('transaction', 'cannot read invites', 'GET', `/api/transactions/${T}/invites`);
    await chk('transaction', 'cannot leave a review', 'POST', `/api/transactions/${T}/review`, { rating: 1, comment: 'x' });
  }

  // ---------- 3. a different approved agent (H) ----------
  console.log('\n== other approved agent (H) ==');
  const hPl = await H.call('GET', `/api/pre-listings/${PL}`);
  const hp = hPl.json && hPl.json.preListing || {};
  record('agent', 'agent sees lockbox notes but never the street address', hp.specialInstructions === MARK.lockbox && !('address' in hp) && !hPl.text.includes(MARK.preAddress), `keys=${Object.keys(hp).join(',').slice(0, 100)}`);
  record('agent', 'agent sees only their own proposal, not competitors\'', hPl.json.bids === null && hPl.json.myBid && hPl.json.myBid.id === HBID && !hPl.text.includes('"AUTHZ bid"'), JSON.stringify(hPl.json.myBid).slice(0, 100));
  const hchk = async (label, method, url, body) => { const r = await H.call(method, url, body); record('agent', label, denied(r), `status ${r.status} ${r.text.slice(0, 90)}`); };
  await hchk('cannot accept a proposal on a pre-listing they don\'t own', 'PUT', `/api/pre-listings/${PL}/bids/${HBID}`, { action: 'accept' });
  await hchk('cannot withdraw a competitor\'s proposal', 'PUT', `/api/pre-listings/${PL}/bids/${GBID}`, { action: 'withdraw' });
  await hchk('non-awarded agent cannot read milestones', 'GET', `/api/pre-listings/${PL}/milestones`);
  await hchk('non-awarded agent cannot add a milestone', 'POST', `/api/pre-listings/${PL}/milestones`, { label: 'x' });
  await hchk('non-awarded agent cannot raise a dispute', 'POST', `/api/pre-listings/${PL}/disputes`, { reason: 'x', description: 'x' });
  await hchk('non-awarded agent cannot review the homeowner', 'POST', `/api/pre-listings/${PL}/review-homeowner`, { rating: 1, comment: 'x' });
  await hchk('cannot edit the pre-listing', 'PUT', `/api/pre-listings/${PL}`, { action: 'close' });
  // "Local agent experts": the tally says how many votes came from agents whose service area covers the home (92104).
  const hVote = await H.call('POST', `/api/pre-listings/${PL2}/votes`, { vote: 'too_high' });
  const hTally = (await H.call('GET', `/api/pre-listings/${PL2}/votes`)).json.votes || {};
  record('agent', 'approved agent can vote; an agent with no service area is not counted as local', hVote.status === 200 && hTally.total === 1 && hTally.nearby === 0, JSON.stringify(hTally));
  sql(`UPDATE agent_profiles SET service_zips_json = '["91910"]' WHERE user_id = ${G.id}`); // Chula Vista, ~8 miles from 92104
  await G.call('POST', `/api/pre-listings/${PL2}/votes`, { vote: 'just_right' });
  const gTally = (await G.call('GET', `/api/pre-listings/${PL2}/votes`)).json.votes || {};
  record('agent', 'a vote from an agent serving a zip within 20 miles counts as local', gTally.total === 2 && gTally.nearby === 1 && gTally.too_high === 1 && gTally.just_right === 1, JSON.stringify(gTally));
  sql(`UPDATE agent_profiles SET service_zips_json = '["90210"]' WHERE user_id = ${G.id}`); // Beverly Hills, ~110 miles away
  const gFar = (await G.call('GET', `/api/pre-listings/${PL2}/votes`)).json.votes || {};
  record('agent', 'an agent serving only a far-away zip is not counted as local', gFar.total === 2 && gFar.nearby === 0, JSON.stringify(gFar));
  sql(`UPDATE agent_profiles SET service_zips_json = '[]' WHERE user_id = ${G.id}`);
  const gPl = await G.call('GET', `/api/pre-listings/${PL}`);
  record('agent', 'awarded agent still cannot see the street address', !('address' in (gPl.json.preListing || {})) && !gPl.text.includes(MARK.preAddress), '');
  const gAccept = await G.call('PUT', `/api/pre-listings/${PL}/bids/${HBID}`, { action: 'accept' });
  record('agent', 'an agent cannot accept proposals on the homeowner\'s behalf', denied(gAccept) || gAccept.status === 400, `status ${gAccept.status}`);
  const gMs = await G.call('GET', `/api/pre-listings/${PL}/milestones`);
  record('agent', 'awarded agent CAN read the checklist', gMs.status === 200, `status ${gMs.status}`);
  const aMs = await A.call('GET', `/api/pre-listings/${PL}/milestones`);
  record('agent', 'homeowner CAN read the checklist', aMs.status === 200, `status ${aMs.status}`);
  if (T) {
    const hTx = await H.call('GET', `/api/transactions/${T}`);
    record('transaction', 'agent sees only their own proposal on a trade', hTx.json.bids === null && hTx.json.myBid && hTx.json.myBid.id === THBID && !hTx.text.includes('"AUTHZ bid"'), JSON.stringify(hTx.json.myBid).slice(0, 100));
    await hchk('cannot accept a trade proposal (not a party)', 'PUT', `/api/transactions/${T}/bids/${THBID}`, { action: 'accept' });
    await hchk('cannot accept the competitor\'s trade proposal', 'PUT', `/api/transactions/${T}/bids/${TGBID}`, { action: 'accept' });
    const cTx = await C.call('PUT', `/api/transactions/${T}/bids/${TGBID}`, { action: 'accept' });
    record('transaction', 'the OTHER trade partner (C) can accept a proposal', cTx.status === 200, `status ${cTx.status} ${cTx.text.slice(0, 80)}`);
    const bTxMs = await B.call('GET', `/api/transactions/${T}/milestones`);
    record('transaction', 'stranger still cannot read the trade checklist after award', denied(bTxMs), `status ${bTxMs.status}`);
    const gTxMs = await G.call('GET', `/api/transactions/${T}/milestones`);
    record('transaction', 'awarded agent can read the trade checklist', gTxMs.status === 200, `status ${gTxMs.status}`);
    const hTxMs = await H.call('GET', `/api/transactions/${T}/milestones`);
    record('transaction', 'the losing agent cannot read the trade checklist', denied(hTxMs), `status ${hTxMs.status}`);
  }

  // ---------- 4. admin + escalation ----------
  console.log('\n== admin / escalation ==');
  for (const [label, method, url, body] of [
    ['approve an agent application', 'PUT', `/api/admin/agent-applications/${B.id}`, { approve: true }],
    ['verify a license', 'PUT', `/api/admin/agent-applications/${G.id}/verify-license`, { verified: true }],
    ['verify a user', 'POST', `/api/admin/users/${A.id}`, { action: 'verify' }],
    ['resolve a report', 'POST', `/api/admin/reports/1`, { action: 'dismiss' }],
    ['resolve a dispute', 'PUT', `/api/admin/disputes/1`, { action: 'resolve' }],
    ['run the seed tool', 'POST', `/api/admin/seed`, { count: 1 }],
    ['read the audit log', 'GET', `/api/admin/audit-log`], ['read the admin overview', 'GET', `/api/admin/overview`],
    ['list agent applications', 'GET', `/api/admin/agent-applications`], ['list reports', 'GET', `/api/admin/reports`], ['list disputes', 'GET', `/api/admin/disputes`],
  ]) { const r = await B.call(method, url, body); record('admin', `ordinary user cannot ${label}`, r.status === 403, `status ${r.status}`); }
  await B.call('PUT', '/api/me', { role: 'admin', isVerified: true, is_verified: 1, email: 'x@example.com', displayName: 'Authz attacker' });
  const bNow = sql(`SELECT role, is_verified, email FROM users WHERE id = ${B.id}`)[0];
  record('privilege', 'PUT /api/me cannot change role, verification or email', bNow.role === 'user' && !bNow.is_verified && bNow.email === B.email, JSON.stringify(bNow));
  const apply = await B.call('POST', '/api/agents/apply', { brokerageName: 'Attacker Realty', licenseNumber: 'FAKE-1', yearsExperience: 3, bio: 'x', defaultCommissionPct: 2,
    services: [{ type: 'photography' }], serviceZips: ['92104'], status: 'approved', licenseVerified: true, license_verified: 1, isApproved: true });
  const bAgent = sql(`SELECT status, license_verified FROM agent_profiles WHERE user_id = ${B.id}`)[0] || {};
  record('privilege', 'applying as an agent cannot self-approve or self-verify', apply.status === 201 && bAgent.status === 'pending' && !bAgent.license_verified, JSON.stringify(bAgent) + ` apply=${apply.status} ${apply.status !== 201 ? apply.text.slice(0, 100) : ''}`);
  const bTryBid = await B.call('POST', `/api/pre-listings/${PL}/bids`, bidBody);
  record('privilege', 'a pending (unapproved) agent cannot submit proposals', denied(bTryBid), `status ${bTryBid.status}`);

  // An approved agent changing their license number must lose the admin's "verified" badge.
  sql(`UPDATE agent_profiles SET license_verified = 1, license_verified_by = ${H.id} WHERE user_id = ${G.id}`);
  const editBody = (lic) => ({ brokerageName: 'Authz Realty One', licenseNumber: lic, yearsExperience: 5, bio: 'bio', defaultCommissionPct: 2, services: [{ type: 'photography' }], serviceZips: ['92104'] });
  await G.call('POST', '/api/agents/apply', editBody('TESTLIC-1'));
  const same = sql(`SELECT status, license_verified FROM agent_profiles WHERE user_id = ${G.id}`)[0];
  record('agent', 'editing a profile without touching the license number keeps "verified"', same.status === 'approved' && same.license_verified === 1, JSON.stringify(same));
  await G.call('POST', '/api/agents/apply', editBody('CHANGED-LICENSE-9'));
  const changed = sql(`SELECT status, license_verified, license_verified_by FROM agent_profiles WHERE user_id = ${G.id}`)[0];
  record('agent', 'changing the license number voids "verified" (approval itself is kept)', changed.status === 'approved' && changed.license_verified === 0 && changed.license_verified_by === null, JSON.stringify(changed));

  // Cross-resource: B owns a listing, then targets A's photo through B's own listing id.
  const lb = await B.call('POST', '/api/listings', listingBody({ title: 'Attacker Home', address: '', clientName: '' }));
  const LB = lb.json && lb.json.id;
  const xdel = await B.call('DELETE', `/api/listings/${LB}/photos/${LA_PHOTO}`);
  const aPhotos = await A.call('GET', `/api/listings/${LA}/photos`);
  record('listings', 'deleting A\'s photo through B\'s own listing id is refused and the photo survives', denied(xdel) && (aPhotos.json.photos || []).some(p => p.id === LA_PHOTO), `del=${xdel.status} photos=${aPhotos.text.slice(0, 80)}`);
  const pfull = await B.call('PUT', `/api/pre-listings/${PL}`, { title: 'HACKED', askingPrice: 1, city: 'x', state: 'CA', zip: '92104', propertyType: 'Condo', beds: 1, baths: 1 });
  const plNow = sql(`SELECT title, status FROM pre_listings WHERE id = ${PL}`)[0];
  record('pre-listing', 'a full edit of A\'s pre-listing by B is refused and nothing changes', denied(pfull) && plNow.title === 'AUTHZ Pre', `status ${pfull.status} row=${JSON.stringify(plNow)}`);
  const pf = await B.call('POST', '/api/portfolios', { title: 'steal', memberListingIds: [LA, LB], locations: 'San Diego, CA', desiredType: 'Any', priceMin: 1, priceMax: 2, minBeds: 0, minBaths: 0 });
  const stolen = sql(`SELECT COUNT(*) AS n FROM portfolio_members WHERE member_listing_id = ${LA}`)[0];
  record('listings', 'B cannot bundle A\'s listing into B\'s portfolio', denied(pf) && stolen.n === 0, `status ${pf.status} members=${stolen.n} ${pf.text.slice(0, 80)}`);

  // Blocks: a signed-in viewer who blocked someone no longer sees their comments; anonymous readers still do.
  await A.call('POST', '/api/blocks', { userId: C.id });
  const aSeesC = await A.call('GET', `/api/posts/${P}/comments`);
  const anonSeesC = await anon.call('GET', `/api/posts/${P}/comments`);
  record('blocks', 'a blocked user\'s comments are hidden from the blocker but not from anonymous readers', !aSeesC.text.includes(MARK.comment) && anonSeesC.text.includes(MARK.comment), `blocker sees=${aSeesC.text.includes(MARK.comment)} anon sees=${anonSeesC.text.includes(MARK.comment)}`);
  const bProp = await B.call('POST', '/api/pre-listings', { title: 'x', askingPrice: 1, city: 'x', state: 'CA', zip: '92104', propertyType: 'Condo', beds: 1, baths: 1, userId: A.id, user_id: A.id });
  const owner = bProp.json && bProp.json.id ? sql(`SELECT user_id FROM pre_listings WHERE id = ${bProp.json.id}`)[0] : null;
  record('privilege', 'creating a pre-listing with someone else\'s user id in the body is ignored', !owner || owner.user_id === B.id, JSON.stringify(owner));
  const lp = await B.call('GET', `/api/license-photos/${G.id}`);
  record('privilege', 'another agent\'s license photo endpoint is forbidden', lp.status === 403, `status ${lp.status}`);

  // Notifications: B marking read must not touch A.
  const aBefore = await A.call('GET', '/api/notifications');
  await B.call('POST', '/api/notifications/read-all');
  const aAfterN = await A.call('GET', '/api/notifications');
  record('notifications', 'B\'s "mark all read" does not affect A\'s unread count', aBefore.json.unreadCount === aAfterN.json.unreadCount, `${aBefore.json.unreadCount} -> ${aAfterN.json.unreadCount}`);

  // ---------- 4b. the owner's own Edit / Close buttons ----------
  console.log('\n== owner edit and close ==');
  const ownerView = (await A.call('GET', `/api/pre-listings/${PL2}`)).json || {};
  const ov = ownerView.preListing || {};
  record('owner', 'the owner gets back everything the edit form needs, including the private address', ownerView.isOwner === true && ov.address === MARK.preAddress && ov.specialInstructions === MARK.lockbox && ov.askingPrice === 750000, JSON.stringify(Object.keys(ov)).slice(0, 120));
  const p2Photo = new FormData(); p2Photo.append('photo', new Blob([PNG], { type: 'image/png' }), 'y.png');
  const PL2PHOTO = ((await A.call('POST', `/api/pre-listings/${PL2}/photos`, undefined, { form: p2Photo })).json || {}).id;
  const tally = async () => ((await A.call('GET', `/api/pre-listings/${PL2}/votes`)).json || {}).votes || {};
  const t0 = await tally();

  // Disclosures checklist — owner-only, regardless of status, and never exposed to anyone else at all.
  const discSet = await A.call('PUT', `/api/pre-listings/${PL2}/disclosures`, { checked: ['tds', 'nhd', 'not-a-real-key'] });
  record('owner', 'the owner can check off disclosure items; an unrecognized key is dropped silently, not an error',
    discSet.status === 200 && JSON.stringify(discSet.json.checked.sort()) === JSON.stringify(['nhd', 'tds']), JSON.stringify(discSet.json));
  const discRow = sql(`SELECT disclosure_checklist_json FROM pre_listings WHERE id = ${PL2}`)[0];
  record('owner', 'the checked set is actually persisted', JSON.parse(discRow.disclosure_checklist_json).sort().join(',') === 'nhd,tds', discRow.disclosure_checklist_json);
  const hDisc = await H.call('PUT', `/api/pre-listings/${PL2}/disclosures`, { checked: ['tds'] });
  record('owner', "another agent can't touch the owner's disclosure checklist", denied(hDisc) && sql(`SELECT disclosure_checklist_json FROM pre_listings WHERE id = ${PL2}`)[0].disclosure_checklist_json === discRow.disclosure_checklist_json, `status ${hDisc.status}`);
  const ownerViewDisc = (await A.call('GET', `/api/pre-listings/${PL2}`)).json.preListing;
  record('owner', "the owner's own GET includes the checklist", JSON.stringify((ownerViewDisc.disclosureChecklist || []).sort()) === JSON.stringify(['nhd', 'tds']), JSON.stringify(ownerViewDisc.disclosureChecklist));
  const hViewDisc = (await H.call('GET', `/api/pre-listings/${PL2}`)).json.preListing;
  record('owner', "nobody else's GET ever includes another owner's checklist", hViewDisc.disclosureChecklist === undefined, JSON.stringify(hViewDisc.disclosureChecklist));

  // Showing requests — PL2 has showingNoticeHours: 24.
  const tooSoon = await G.call('POST', `/api/pre-listings/${PL2}/showings`, { proposedAt: new Date(Date.now() + 2 * 3600000).toISOString() });
  record('owner', "a showing proposed sooner than the pre-listing's own notice requirement is refused", denied(tooSoon), `status ${tooSoon.status} ${tooSoon.text.slice(0, 80)}`);
  const pastShowing = await G.call('POST', `/api/pre-listings/${PL2}/showings`, { proposedAt: new Date(Date.now() - 3600000).toISOString() });
  record('owner', 'a showing proposed in the past is refused', denied(pastShowing), `status ${pastShowing.status}`);
  const showingOk = await G.call('POST', `/api/pre-listings/${PL2}/showings`, { proposedAt: new Date(Date.now() + 48 * 3600000).toISOString(), note: 'AUTHZ showing' });
  record('owner', 'a showing proposed with enough notice succeeds', showingOk.status === 201, `status ${showingOk.status} ${showingOk.text.slice(0, 80)}`);
  const SHOWING = showingOk.json && showingOk.json.id;
  const hShowingList = (await H.call('GET', `/api/pre-listings/${PL2}/showings`)).json.showings;
  record('owner', "another agent's showing list never includes a competitor's request", !hShowingList.some(s => s.id === SHOWING), JSON.stringify(hShowingList));
  const hDecide = await H.call('PUT', `/api/pre-listings/${PL2}/showings/${SHOWING}`, { action: 'accept' });
  record('owner', "an agent who didn't own the pre-listing can't accept a showing on it", denied(hDecide), `status ${hDecide.status}`);
  const hCancel = await H.call('PUT', `/api/pre-listings/${PL2}/showings/${SHOWING}`, { action: 'cancel' });
  record('owner', "an agent can't cancel another agent's showing request", denied(hCancel), `status ${hCancel.status}`);
  const ownerAccept = await A.call('PUT', `/api/pre-listings/${PL2}/showings/${SHOWING}`, { action: 'accept' });
  const showingRow = sql(`SELECT status FROM pre_listing_showings WHERE id = ${SHOWING}`)[0];
  record('owner', 'the owner can accept a showing request on their own pre-listing', ownerAccept.status === 200 && showingRow.status === 'accepted', `status ${ownerAccept.status} row=${JSON.stringify(showingRow)}`);
  const reAccept = await A.call('PUT', `/api/pre-listings/${PL2}/showings/${SHOWING}`, { action: 'decline' });
  record('owner', "a decided showing can't be decided again", denied(reAccept), `status ${reAccept.status}`);

  // ---------- agent teams (G and H, the two approved agents already set up above) ----------
  console.log('\n== agent teams ==');
  const teamCreate = await G.call('POST', '/api/agent-teams', { name: 'AUTHZ Team' });
  record('team', 'an approved agent can create a team', teamCreate.status === 201, `status ${teamCreate.status} ${teamCreate.text.slice(0, 100)}`);
  const TEAMID = teamCreate.json && (teamCreate.json.id ?? teamCreate.json.teamId);
  const bCreate = await B.call('POST', '/api/agent-teams', { name: 'Should fail' });
  record('team', "a non-agent can't create a team", denied(bCreate), `status ${bCreate.status}`);
  const bInvite = await B.call('POST', `/api/agent-teams/${TEAMID}/invite`, { agentUserId: H.id });
  record('team', "someone who isn't on the team can't invite into it", denied(bInvite), `status ${bInvite.status}`);
  const teamInvite = await G.call('POST', `/api/agent-teams/${TEAMID}/invite`, { agentUserId: H.id });
  record('team', 'the owner can invite another approved agent', teamInvite.status === 200, `status ${teamInvite.status} ${teamInvite.text.slice(0, 100)}`);
  const bAcceptForH = await B.call('PUT', `/api/agent-teams/${TEAMID}/members/${H.id}`, { action: 'accept' });
  record('team', "nobody but the invitee can accept H's invite", denied(bAcceptForH), `status ${bAcceptForH.status}`);
  const hBeforeAccept = await H.call('GET', '/api/agent-teams/me');
  record('team', 'the invited agent sees the pending invite with the team name', hBeforeAccept.json.myStatus === 'invited' && hBeforeAccept.json.team.name === 'AUTHZ Team', JSON.stringify(hBeforeAccept.json));
  const hAccept = await H.call('PUT', `/api/agent-teams/${TEAMID}/members/${H.id}`, { action: 'accept' });
  record('team', 'the invited agent can accept', hAccept.status === 200, `status ${hAccept.status}`);
  const dirAfterJoin = await A.call('GET', '/api/agents/directory');
  const gEntry = dirAfterJoin.json.agents.find(a => a.userId === G.id);
  const hEntry = dirAfterJoin.json.agents.find(a => a.userId === H.id);
  record('team', "both members' directory entries show the team name", gEntry && gEntry.teamName === 'AUTHZ Team' && hEntry && hEntry.teamName === 'AUTHZ Team', JSON.stringify({ g: gEntry && gEntry.teamName, h: hEntry && hEntry.teamName }));
  const hRemovesG = await H.call('PUT', `/api/agent-teams/${TEAMID}/members/${G.id}`, { action: 'remove' });
  record('team', "a regular member (not the owner) can't remove anyone", denied(hRemovesG), `status ${hRemovesG.status}`);
  const gRemovesH = await G.call('PUT', `/api/agent-teams/${TEAMID}/members/${H.id}`, { action: 'remove' });
  const dirAfterRemove = ((await A.call('GET', '/api/agents/directory')).json.agents).find(a => a.userId === H.id);
  record('team', 'the owner can remove a member, who immediately drops the team name', gRemovesH.status === 200 && dirAfterRemove && dirAfterRemove.teamName === null, `status ${gRemovesH.status} teamName=${dirAfterRemove && dirAfterRemove.teamName}`);
  const gLeaves = await G.call('PUT', `/api/agent-teams/${TEAMID}/members/${G.id}`, { action: 'leave' });
  const teamRow = sql(`SELECT COUNT(*) AS n FROM agent_teams WHERE id = ${TEAMID}`)[0];
  record('team', 'the last member leaving deletes the team entirely (nobody left stuck owning an empty team)', gLeaves.status === 200 && teamRow.n === 0, `status ${gLeaves.status} rows=${teamRow.n}`);

  // ---------- messaging an agent straight from a proposal/directory card ----------
  console.log('\n== messaging ==');
  const selfMsg = await A.call('POST', '/api/conversations', { userId: A.id });
  record('messaging', "can't start a conversation with yourself", denied(selfMsg), `status ${selfMsg.status}`);
  const startConvo = await A.call('POST', '/api/conversations', { userId: G.id });
  record('messaging', 'the homeowner can start a conversation with an agent (e.g. from their proposal card)', startConvo.status === 200 || startConvo.status === 201, `status ${startConvo.status} ${startConvo.text.slice(0, 100)}`);
  const CONVO = startConvo.json && startConvo.json.id;
  const sendMsg = await A.call('POST', `/api/conversations/${CONVO}/messages`, { body: 'AUTHZ test message' });
  record('messaging', 'sending a message succeeds', sendMsg.status === 201, `status ${sendMsg.status}`);
  const bReadConvo = await B.call('GET', `/api/conversations/${CONVO}/messages`);
  record('messaging', "someone who isn't in the conversation can't read it", denied(bReadConvo), `status ${bReadConvo.status}`);
  const bPostConvo = await B.call('POST', `/api/conversations/${CONVO}/messages`, { body: 'should not work' });
  record('messaging', "someone who isn't in the conversation can't post into it", denied(bPostConvo), `status ${bPostConvo.status}`);
  const gNotif = sql(`SELECT body FROM notifications WHERE user_id = ${G.id} AND body = 'New message from Authz homeowner'`);
  record('messaging', 'the recipient gets an in-app notification naming the sender (not the message content)', gNotif.length > 0, JSON.stringify(gNotif));

  // my-bids: askingPrice/userId fix found while building the agent's "check in with the homeowner" button -
  // the raw snake_case row was being returned as-is, so target.askingPrice was always undefined (silently
  // rendered as "$0" by money()) and there was no userId at all to message.
  const myBids = await G.call('GET', '/api/agents/my-bids');
  const glBid = myBids.json.bids.find(b => b.requestId === Number(PL));
  record('messaging', "an agent's own proposal list shows the real asking price and the homeowner's user id, not undefined",
    glBid && glBid.preListing && glBid.preListing.askingPrice === 750000 && glBid.preListing.userId === A.id,
    JSON.stringify(glBid && glBid.preListing));

  // ---------- "needs your attention" counts (owner's own mine=1 list only) ----------
  console.log('\n== attention counts ==');
  // PL is awarded and PL2 is closed by this point in the run (both now have 0 pending bids, correctly, since
  // accepting one proposal auto-declines the rest) — a fresh one with an actual pending bid is needed to check
  // the count logic for real, and it also doubles as the public-browse check below (PL/PL2 no longer show up
  // in the open-only browse list at all once awarded/closed).
  const plOpen = ((await A.call('POST', '/api/pre-listings', PL2_BODY)).json || {}).id;
  const plOpenBid = await H.call('POST', `/api/pre-listings/${plOpen}/bids`, bidBody);
  const ownerMine = (await A.call('GET', '/api/pre-listings?mine=1')).json.preListings.find(p => p.id === plOpen);
  record('attention', "the owner's own pre-listing list shows how many pending proposals/showings need a decision",
    plOpenBid.status === 201 && ownerMine && ownerMine.pendingBidCount === 1 && ownerMine.pendingShowingCount === 0, JSON.stringify(ownerMine && { pendingBidCount: ownerMine.pendingBidCount, pendingShowingCount: ownerMine.pendingShowingCount }));
  const publicBrowse = (await H.call('GET', '/api/pre-listings')).json.preListings.find(p => p.id === plOpen);
  record('attention', "those counts are never computed for anyone browsing the public open list, only the owner's own mine=1 view",
    publicBrowse && publicBrowse.pendingBidCount === null && publicBrowse.pendingShowingCount === null, JSON.stringify(publicBrowse && { pendingBidCount: publicBrowse.pendingBidCount, pendingShowingCount: publicBrowse.pendingShowingCount }));

  const e1 = await A.call('PUT', `/api/pre-listings/${PL2}`, { ...PL2_BODY, title: 'AUTHZ Pre 2 edited', beds: 4 });
  const row1 = sql(`SELECT title, beds, asking_price FROM pre_listings WHERE id = ${PL2}`)[0];
  record('owner', 'the owner can edit their open pre-listing', e1.status === 200 && row1.title === 'AUTHZ Pre 2 edited' && row1.beds === 4, `status ${e1.status} row=${JSON.stringify(row1)}`);
  record('owner', 'editing without touching the price keeps the price votes', e1.json && e1.json.votesCleared === 0 && (await tally()).total === t0.total && t0.total === 2, `votes ${JSON.stringify(await tally())}`);
  const eBad = await A.call('PUT', `/api/pre-listings/${PL2}`, { ...PL2_BODY, zip: 'abc' });
  record('owner', 'an edit with invalid details is refused and changes nothing', eBad.status === 400 && sql(`SELECT zip FROM pre_listings WHERE id = ${PL2}`)[0].zip === '92104', `status ${eBad.status}`);

  const bDelPhoto = await B.call('DELETE', `/api/pre-listings/${PL2}/photos/${PL2PHOTO}`);
  const hDelPhoto = await H.call('DELETE', `/api/pre-listings/${PL2}/photos/${PL2PHOTO}`);
  const anonDelPhoto = await anon.call('DELETE', `/api/pre-listings/${PL2}/photos/${PL2PHOTO}`);
  record('owner', "neither another user, another agent nor an anonymous visitor can remove the owner's photo", denied(bDelPhoto) && denied(hDelPhoto) && denied(anonDelPhoto) && sql(`SELECT COUNT(*) AS n FROM pre_listing_photos WHERE id = ${PL2PHOTO}`)[0].n === 1, `b=${bDelPhoto.status} h=${hDelPhoto.status} anon=${anonDelPhoto.status}`);
  const bOwn = bProp.json && bProp.json.id;
  if (bOwn) {
    const viaOwn = await B.call('DELETE', `/api/pre-listings/${bOwn}/photos/${PL2PHOTO}`);
    record('owner', "B's own pre-listing id can't be used to remove A's photo", denied(viaOwn) && sql(`SELECT COUNT(*) AS n FROM pre_listing_photos WHERE id = ${PL2PHOTO}`)[0].n === 1, `status ${viaOwn.status}`);
  }

  const e2 = await A.call('PUT', `/api/pre-listings/${PL2}`, { ...PL2_BODY, askingPrice: 700000 });
  const t2 = await tally();
  record('owner', 'changing the asking price clears the price votes (they were about the old price)', e2.status === 200 && e2.json.votesCleared === 2 && t2.total === 0 && t2.nearby === 0, `status ${e2.status} ${JSON.stringify(e2.json)} tally ${JSON.stringify(t2)}`);

  const delOwn = await A.call('DELETE', `/api/pre-listings/${PL2}/photos/${PL2PHOTO}`);
  const gone = await A.call('GET', `/api/pre-listing-photos/${PL2PHOTO}`);
  record('owner', 'the owner can remove their own photo (and the file is gone)', delOwn.status === 200 && gone.status === 404 && sql(`SELECT COUNT(*) AS n FROM pre_listing_photos WHERE id = ${PL2PHOTO}`)[0].n === 0, `delete ${delOwn.status}, fetch ${gone.status}`);

  const awardedClose = await A.call('PUT', `/api/pre-listings/${PL}`, { action: 'close' });
  record('owner', 'an awarded pre-listing cannot be closed out from under its agent', awardedClose.status === 400 && sql(`SELECT status FROM pre_listings WHERE id = ${PL}`)[0].status === 'awarded', `status ${awardedClose.status}`);
  const awardedEdit = await A.call('PUT', `/api/pre-listings/${PL}`, { ...PL2_BODY, title: 'AUTHZ Pre' });
  record('owner', 'an awarded pre-listing cannot be edited', awardedEdit.status === 400, `status ${awardedEdit.status}`);

  const hBrowseBefore = ((await H.call('GET', '/api/pre-listings')).json || {}).preListings || [];
  const close1 = await A.call('PUT', `/api/pre-listings/${PL2}`, { action: 'close' });
  record('owner', 'the owner can close their open pre-listing', close1.status === 200 && sql(`SELECT status FROM pre_listings WHERE id = ${PL2}`)[0].status === 'closed', `status ${close1.status}`);
  const hBrowseAfter = ((await H.call('GET', '/api/pre-listings')).json || {}).preListings || [];
  record('owner', 'a closed pre-listing drops out of the agents\' browse list', hBrowseBefore.some(x => x.id === PL2) && !hBrowseAfter.some(x => x.id === PL2), `before=${hBrowseBefore.length} after=${hBrowseAfter.length}`);
  const hVoteClosed = await H.call('POST', `/api/pre-listings/${PL2}/votes`, { vote: 'just_right' });
  const hBidClosed = await H.call('POST', `/api/pre-listings/${PL2}/bids`, bidBody);
  record('owner', 'a closed pre-listing takes no more votes or proposals', hVoteClosed.status === 400 && hBidClosed.status === 400 && (await tally()).total === 0, `vote ${hVoteClosed.status} bid ${hBidClosed.status}`);
  const close2 = await A.call('PUT', `/api/pre-listings/${PL2}`, { action: 'close' });
  const editClosed = await A.call('PUT', `/api/pre-listings/${PL2}`, { ...PL2_BODY, title: 'reopened?' });
  record('owner', 'a closed pre-listing cannot be closed again or edited', close2.status === 400 && editClosed.status === 400 && sql(`SELECT title FROM pre_listings WHERE id = ${PL2}`)[0].title === 'AUTHZ Pre 2', `close ${close2.status} edit ${editClosed.status}`);

  // ---------- AugmentedHomes ----------
  console.log('\n== augmented homes ==');
  const augBody = { title: 'AUTHZ Adapted Home', askingPrice: 625000, city: 'San Diego', state: 'CA', zip: '92104', address: MARK.augAddress,
    propertyType: 'Single Family Home', beds: 3, baths: 2, adaptations: ['roll_in_shower', 'grab_bars_handrails'], adaptationNotes: 'authz notes' };
  const augCreate = await A.call('POST', '/api/augmented-homes', augBody);
  const AUG = augCreate.json && augCreate.json.id;
  record('augmented', 'owner can create a listing with adaptations', augCreate.status === 201, `status ${augCreate.status} ${augCreate.text.slice(0, 100)}`);
  const augNoAdapt = await A.call('POST', '/api/augmented-homes', { ...augBody, adaptations: [] });
  record('augmented', 'creating with no adaptations checked is refused', augNoAdapt.status === 400, `status ${augNoAdapt.status}`);
  const augAsOwner = (await A.call('GET', `/api/augmented-homes/${AUG}`)).json || {};
  record('augmented', 'the owner sees the private street address', augAsOwner.isOwner === true && augAsOwner.home && augAsOwner.home.address === MARK.augAddress, JSON.stringify(augAsOwner.home && Object.keys(augAsOwner.home)));
  const augAsB = await B.call('GET', `/api/augmented-homes/${AUG}`);
  const augB = (augAsB.json && augAsB.json.home) || {};
  record('augmented', "a non-owner never sees the address, even in the raw response body", augAsB.status === 200 && augB.address === undefined && !augAsB.text.includes(MARK.augAddress), `keys=${Object.keys(augB).join(',')}`);
  await chk('augmented', "a non-owner can't change the listing status", 'PUT', `/api/augmented-homes/${AUG}`, { action: 'set-status', status: 'sold' });
  await chk('augmented', "a non-owner can't delete the listing", 'DELETE', `/api/augmented-homes/${AUG}`);
  { const f = new FormData(); f.append('photo', new Blob([PNG], { type: 'image/png' }), 'x.png'); const r = await B.call('POST', `/api/augmented-homes/${AUG}/photos`, undefined, { form: f }); record('augmented', "a non-owner can't add photos", denied(r), `status ${r.status}`); }
  const augFilterHit = (await B.call('GET', '/api/augmented-homes?adaptation=roll_in_shower')).json.homes;
  record('augmented', 'the adaptation filter includes a matching home', augFilterHit.some(h => h.id === AUG), JSON.stringify(augFilterHit.map(h => h.id)));
  const augFilterMiss = (await B.call('GET', '/api/augmented-homes?adaptation=hearing_impairment_features')).json.homes;
  record('augmented', 'the adaptation filter excludes a non-matching home', !augFilterMiss.some(h => h.id === AUG), JSON.stringify(augFilterMiss.map(h => h.id)));
  const augGet0 = (await A.call('GET', `/api/augmented-homes/${AUG}`)).json.home;
  record('augmented', 'priceHistory starts empty', Array.isArray(augGet0.priceHistory) && augGet0.priceHistory.length === 0, JSON.stringify(augGet0.priceHistory));
  const augEdit = await A.call('PUT', `/api/augmented-homes/${AUG}`, { ...augBody, askingPrice: 600000, lifeEventTags: ['downsizing', 'not_a_real_tag'] });
  record('augmented', 'owner can edit price and life-event tags', augEdit.status === 200, JSON.stringify(augEdit));
  const augGet1 = (await A.call('GET', `/api/augmented-homes/${AUG}`)).json.home;
  record('augmented', 'price change is logged in priceHistory', augGet1.priceHistory.length === 1 && augGet1.priceHistory[0].oldPrice === 625000 && augGet1.priceHistory[0].newPrice === 600000, JSON.stringify(augGet1.priceHistory));
  record('augmented', 'a bogus life-event key is filtered, a valid one kept', JSON.stringify(augGet1.lifeEventTags) === JSON.stringify(['downsizing']), JSON.stringify(augGet1.lifeEventTags));

  const augPublicPage = await anon.call('GET', `/augmented-home/${AUG}`);
  record('augmented', 'the public share page is visible while active, anonymously', augPublicPage.status === 200 && augPublicPage.text.includes('AUTHZ Adapted Home'), `status ${augPublicPage.status}`);
  record('augmented', "the public share page never leaks the street address", !augPublicPage.text.includes(MARK.augAddress), '');
  const augPublic404 = await anon.call('GET', '/augmented-home/999999999');
  record('augmented', 'the public share page 404s for a bogus id', augPublic404.status === 404, `status ${augPublic404.status}`);

  // ---------- AugmentedHomes: offers, multi-round counters, open houses, favorites, price-drop ----------
  const augOfferByOwner = await A.call('POST', `/api/augmented-homes/${AUG}/offers`, { offerPrice: 500000 });
  record('augmented', "owner can't offer on their own listing", augOfferByOwner.status === 400, `status ${augOfferByOwner.status}`);
  const augOffer = await B.call('POST', `/api/augmented-homes/${AUG}/offers`, { offerPrice: 550000, message: MARK.offerMessage });
  const AUG_OFFER = augOffer.json && augOffer.json.id;
  record('augmented', 'buyer can submit an offer', augOffer.status === 201, `status ${augOffer.status}`);
  const augDupeOffer = await B.call('POST', `/api/augmented-homes/${AUG}/offers`, { offerPrice: 560000 });
  record('augmented', "buyer can't submit a 2nd offer while one is live", augDupeOffer.status === 400, `status ${augDupeOffer.status}`);
  const augCounterByStranger = await C.call('PUT', `/api/augmented-homes/${AUG}/offers/${AUG_OFFER}`, { action: 'counter', counterPrice: 580000 });
  record('augmented', "a stranger can't counter someone else's offer", denied(augCounterByStranger), `status ${augCounterByStranger.status}`);
  const augCounter1 = await A.call('PUT', `/api/augmented-homes/${AUG}/offers/${AUG_OFFER}`, { action: 'counter', counterPrice: 580000, counterMessage: 'r1' });
  record('augmented', 'round 1: owner counters the pending offer', augCounter1.status === 200, `status ${augCounter1.status}`);
  const augCounter2 = await B.call('PUT', `/api/augmented-homes/${AUG}/offers/${AUG_OFFER}`, { action: 'counter', counterPrice: 560000, counterMessage: 'r2' });
  record('augmented', 'round 2: buyer counters back', augCounter2.status === 200, `status ${augCounter2.status}`);
  let augOfferRow = sql(`SELECT status, countered_by, counter_price FROM augmented_home_offers WHERE id = ${AUG_OFFER}`)[0];
  record('augmented', 'after round 2: countered_by=buyer, price updated', augOfferRow.countered_by === 'buyer' && augOfferRow.counter_price === 560000, JSON.stringify(augOfferRow));
  const augAcceptCounter = await A.call('PUT', `/api/augmented-homes/${AUG}/offers/${AUG_OFFER}`, { action: 'accept_counter' });
  record('augmented', 'owner accepts the counter', augAcceptCounter.status === 200, `status ${augAcceptCounter.status}`);
  augOfferRow = sql(`SELECT status, offer_price, counter_price FROM augmented_home_offers WHERE id = ${AUG_OFFER}`)[0];
  record('augmented', 'final: accepted at the counter price', augOfferRow.status === 'accepted' && augOfferRow.offer_price === 560000, JSON.stringify(augOfferRow));

  const augOhByStranger = await C.call('POST', `/api/augmented-homes/${AUG}/open-houses`, { startsAt: new Date(Date.now() + 48 * 3600000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600000).toISOString() });
  record('augmented', "a non-owner can't schedule an open house", denied(augOhByStranger), `status ${augOhByStranger.status}`);
  const augOhCreate = await A.call('POST', `/api/augmented-homes/${AUG}/open-houses`, { startsAt: new Date(Date.now() + 48 * 3600000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600000).toISOString(), note: 'AUTHZ open house' });
  record('augmented', 'owner can schedule an open house', augOhCreate.status === 201, `status ${augOhCreate.status}`);
  const AUG_OH = augOhCreate.json && augOhCreate.json.id;
  const augRsvp = await B.call('POST', `/api/augmented-homes/${AUG}/open-houses/${AUG_OH}/rsvp`, {});
  record('augmented', 'a signed-in user can RSVP', augRsvp.json && augRsvp.json.going === true, JSON.stringify(augRsvp.json));
  const augOhDeleteByStranger = await C.call('DELETE', `/api/augmented-homes/${AUG}/open-houses/${AUG_OH}`);
  record('augmented', "a non-owner can't cancel someone else's open house", denied(augOhDeleteByStranger), `status ${augOhDeleteByStranger.status}`);

  const augFavOn = await C.call('PUT', `/api/augmented-homes/${AUG}/favorite`, {});
  record('augmented', 'a user can favorite the listing', augFavOn.json && augFavOn.json.favorited === true, JSON.stringify(augFavOn.json));
  const augFavList = (await C.call('GET', '/api/augmented-homes?favorites=1')).json.homes;
  record('augmented', 'favorited home shows up in favorites list', augFavList.some(h => h.id === AUG), JSON.stringify(augFavList.map(h => h.id)));
  const augPriceDrop = await A.call('PUT', `/api/augmented-homes/${AUG}`, { ...augBody, askingPrice: 575000, lifeEventTags: ['downsizing'] });
  record('augmented', 'owner can drop the price again', augPriceDrop.status === 200, `status ${augPriceDrop.status}`);
  const cNotifPriceDrop = sql(`SELECT body FROM notifications WHERE user_id = ${C.id} AND body LIKE '%dropped in price%'`);
  record('augmented', 'favoriter is notified of the price drop', cNotifPriceDrop.length > 0, JSON.stringify(cNotifPriceDrop));

  const augStatus = await A.call('PUT', `/api/augmented-homes/${AUG}`, { action: 'set-status', status: 'under_contract' });
  record('augmented', 'the owner can change their own listing status', augStatus.status === 200 && sql(`SELECT status FROM augmented_homes WHERE id = ${AUG}`)[0].status === 'under_contract', `status ${augStatus.status}`);
  const augPublicAfter = await anon.call('GET', `/augmented-home/${AUG}`);
  record('augmented', 'a no-longer-active listing drops off its public share page too', augPublicAfter.status === 404, `status ${augPublicAfter.status}`);
  const augBrowseAfter = (await B.call('GET', '/api/augmented-homes')).json.homes;
  record('augmented', 'a listing no longer active drops out of the public browse list', !augBrowseAfter.some(h => h.id === AUG), JSON.stringify(augBrowseAfter.map(h => h.id)));

  const alertCreate = await B.call('POST', '/api/accessibility-needs-alerts', { label: 'AUTHZ alert', adaptations: ['roll_in_shower'], city: 'San Diego', state: 'CA' });
  const ALERT = alertCreate.json && alertCreate.json.id;
  record('augmented', 'another user can save a needs alert', alertCreate.status === 201, `status ${alertCreate.status}`);
  const augMatch = await A.call('POST', '/api/augmented-homes', { ...augBody, title: 'AUTHZ Adapted Home 2', address: '' });
  const AUG2 = augMatch.json && augMatch.json.id;
  const bNotifAfterMatch = sql(`SELECT body FROM notifications WHERE user_id = ${B.id} AND body LIKE 'A new AugmentedHomes listing%AUTHZ alert%'`);
  record('augmented', 'posting a newly-matching home notifies the saved alert\'s owner', bNotifAfterMatch.length > 0, JSON.stringify(bNotifAfterMatch));
  await A.call('DELETE', `/api/accessibility-needs-alerts/${ALERT}`);
  const alertsAfterAttempt = (await B.call('GET', '/api/accessibility-needs-alerts')).json.alerts;
  record('augmented', "another user cannot delete someone else's needs alert", alertsAfterAttempt.some(a => a.id === ALERT), JSON.stringify(alertsAfterAttempt.map(a => a.id)));
  await B.call('DELETE', `/api/accessibility-needs-alerts/${ALERT}`);
  const alertsAfterOwn = (await B.call('GET', '/api/accessibility-needs-alerts')).json.alerts;
  record('augmented', 'the alert\'s own owner can delete it', !alertsAfterOwn.some(a => a.id === ALERT), JSON.stringify(alertsAfterOwn.map(a => a.id)));

  // ---------- GreenHomes ----------
  console.log('\n== green homes ==');
  const greenBody = { title: 'AUTHZ Green Home', askingPrice: 710000, city: 'San Diego', state: 'CA', zip: '92104', address: MARK.greenAddress,
    propertyType: 'Single Family Home', beds: 3, baths: 2, greenFeatures: ['solar_panels', 'ev_charger'], featureNotes: 'authz notes' };
  const greenCreate = await A.call('POST', '/api/green-homes', greenBody);
  const GREEN = greenCreate.json && greenCreate.json.id;
  record('green', 'owner can create a listing with green features', greenCreate.status === 201, `status ${greenCreate.status} ${greenCreate.text.slice(0, 100)}`);
  const greenNoFeature = await A.call('POST', '/api/green-homes', { ...greenBody, greenFeatures: [] });
  record('green', 'creating with no green features checked is refused', greenNoFeature.status === 400, `status ${greenNoFeature.status}`);
  const greenAsOwner = (await A.call('GET', `/api/green-homes/${GREEN}`)).json || {};
  record('green', 'the owner sees the private street address', greenAsOwner.isOwner === true && greenAsOwner.home && greenAsOwner.home.address === MARK.greenAddress, JSON.stringify(greenAsOwner.home && Object.keys(greenAsOwner.home)));
  const greenAsB = await B.call('GET', `/api/green-homes/${GREEN}`);
  const greenB = (greenAsB.json && greenAsB.json.home) || {};
  record('green', "a non-owner never sees the address, even in the raw response body", greenAsB.status === 200 && greenB.address === undefined && !greenAsB.text.includes(MARK.greenAddress), `keys=${Object.keys(greenB).join(',')}`);
  await chk('green', "a non-owner can't change the listing status", 'PUT', `/api/green-homes/${GREEN}`, { action: 'set-status', status: 'sold' });
  await chk('green', "a non-owner can't delete the listing", 'DELETE', `/api/green-homes/${GREEN}`);
  { const f = new FormData(); f.append('photo', new Blob([PNG], { type: 'image/png' }), 'x.png'); const r = await B.call('POST', `/api/green-homes/${GREEN}/photos`, undefined, { form: f }); record('green', "a non-owner can't add photos", denied(r), `status ${r.status}`); }
  const greenFilterHit = (await B.call('GET', '/api/green-homes?feature=solar_panels')).json.homes;
  record('green', 'the feature filter includes a matching home', greenFilterHit.some(h => h.id === GREEN), JSON.stringify(greenFilterHit.map(h => h.id)));
  const greenFilterMiss = (await B.call('GET', '/api/green-homes?feature=geothermal')).json.homes;
  record('green', 'the feature filter excludes a non-matching home', !greenFilterMiss.some(h => h.id === GREEN), JSON.stringify(greenFilterMiss.map(h => h.id)));
  const greenGet0 = (await A.call('GET', `/api/green-homes/${GREEN}`)).json.home;
  record('green', 'priceHistory starts empty', Array.isArray(greenGet0.priceHistory) && greenGet0.priceHistory.length === 0, JSON.stringify(greenGet0.priceHistory));
  const greenEdit = await A.call('PUT', `/api/green-homes/${GREEN}`, { ...greenBody, askingPrice: 690000, lifeEventTags: ['relocation', 'not_a_real_tag'] });
  record('green', 'owner can edit price and life-event tags', greenEdit.status === 200, JSON.stringify(greenEdit));
  const greenGet1 = (await A.call('GET', `/api/green-homes/${GREEN}`)).json.home;
  record('green', 'price change is logged in priceHistory', greenGet1.priceHistory.length === 1 && greenGet1.priceHistory[0].oldPrice === 710000 && greenGet1.priceHistory[0].newPrice === 690000, JSON.stringify(greenGet1.priceHistory));
  record('green', 'a bogus life-event key is filtered, a valid one kept', JSON.stringify(greenGet1.lifeEventTags) === JSON.stringify(['relocation']), JSON.stringify(greenGet1.lifeEventTags));

  const greenAlertNoFeature = await B.call('POST', '/api/green-needs-alerts', { label: 'x', greenFeatures: [] });
  record('green', 'a green alert with no features checked is refused', greenAlertNoFeature.status === 400, `status ${greenAlertNoFeature.status}`);
  const greenAlertCreate = await B.call('POST', '/api/green-needs-alerts', { label: 'AUTHZ green alert', greenFeatures: ['solar_panels'], city: 'San Diego', state: 'CA' });
  const GREEN_ALERT = greenAlertCreate.json && greenAlertCreate.json.id;
  record('green', 'another user can save a green needs alert', greenAlertCreate.status === 201, `status ${greenAlertCreate.status}`);
  const greenMatch = await A.call('POST', '/api/green-homes', { ...greenBody, title: 'AUTHZ Green Home 2', address: '' });
  const bNotifAfterGreenMatch = sql(`SELECT body FROM notifications WHERE user_id = ${B.id} AND body LIKE 'A new GreenHomes listing%AUTHZ green alert%'`);
  record('green', "posting a newly-matching home notifies the saved alert's owner", bNotifAfterGreenMatch.length > 0, JSON.stringify(bNotifAfterGreenMatch));
  await A.call('DELETE', `/api/green-needs-alerts/${GREEN_ALERT}`);
  const greenAlertsAfterAttempt = (await B.call('GET', '/api/green-needs-alerts')).json.alerts;
  record('green', "another user cannot delete someone else's green needs alert", greenAlertsAfterAttempt.some(a => a.id === GREEN_ALERT), JSON.stringify(greenAlertsAfterAttempt.map(a => a.id)));
  await B.call('DELETE', `/api/green-needs-alerts/${GREEN_ALERT}`);
  const greenAlertsAfterOwn = (await B.call('GET', '/api/green-needs-alerts')).json.alerts;
  record('green', "the alert's own owner can delete it", !greenAlertsAfterOwn.some(a => a.id === GREEN_ALERT), JSON.stringify(greenAlertsAfterOwn.map(a => a.id)));

  const greenPublicPage = await anon.call('GET', `/green-home/${GREEN}`);
  record('green', 'the public share page is visible while active, anonymously', greenPublicPage.status === 200 && greenPublicPage.text.includes('AUTHZ Green Home'), `status ${greenPublicPage.status}`);
  record('green', "the public share page never leaks the street address", !greenPublicPage.text.includes(MARK.greenAddress), '');
  const greenPublic404 = await anon.call('GET', '/green-home/999999999');
  record('green', 'the public share page 404s for a bogus id', greenPublic404.status === 404, `status ${greenPublic404.status}`);

  // ---------- GreenHomes: offers, multi-round counters, open houses, favorites, price-drop ----------
  const greenOfferByOwner = await A.call('POST', `/api/green-homes/${GREEN}/offers`, { offerPrice: 500000 });
  record('green', "owner can't offer on their own listing", greenOfferByOwner.status === 400, `status ${greenOfferByOwner.status}`);
  const greenOffer = await B.call('POST', `/api/green-homes/${GREEN}/offers`, { offerPrice: 650000, message: MARK.offerMessage });
  const GREEN_OFFER = greenOffer.json && greenOffer.json.id;
  record('green', 'buyer can submit an offer', greenOffer.status === 201, `status ${greenOffer.status}`);
  const greenDupeOffer = await B.call('POST', `/api/green-homes/${GREEN}/offers`, { offerPrice: 660000 });
  record('green', "buyer can't submit a 2nd offer while one is live", greenDupeOffer.status === 400, `status ${greenDupeOffer.status}`);
  const greenCounterByStranger = await C.call('PUT', `/api/green-homes/${GREEN}/offers/${GREEN_OFFER}`, { action: 'counter', counterPrice: 670000 });
  record('green', "a stranger can't counter someone else's offer", denied(greenCounterByStranger), `status ${greenCounterByStranger.status}`);
  const greenCounter1 = await A.call('PUT', `/api/green-homes/${GREEN}/offers/${GREEN_OFFER}`, { action: 'counter', counterPrice: 670000, counterMessage: 'r1' });
  record('green', 'round 1: owner counters the pending offer', greenCounter1.status === 200, `status ${greenCounter1.status}`);
  const greenCounter2 = await B.call('PUT', `/api/green-homes/${GREEN}/offers/${GREEN_OFFER}`, { action: 'counter', counterPrice: 655000, counterMessage: 'r2' });
  record('green', 'round 2: buyer counters back', greenCounter2.status === 200, `status ${greenCounter2.status}`);
  let greenOfferRow = sql(`SELECT status, countered_by, counter_price FROM green_home_offers WHERE id = ${GREEN_OFFER}`)[0];
  record('green', 'after round 2: countered_by=buyer, price updated', greenOfferRow.countered_by === 'buyer' && greenOfferRow.counter_price === 655000, JSON.stringify(greenOfferRow));
  const greenDeclineCounter = await A.call('PUT', `/api/green-homes/${GREEN}/offers/${GREEN_OFFER}`, { action: 'decline_counter' });
  record('green', 'owner can decline the counter', greenDeclineCounter.status === 200, `status ${greenDeclineCounter.status}`);
  greenOfferRow = sql(`SELECT status FROM green_home_offers WHERE id = ${GREEN_OFFER}`)[0];
  record('green', 'declined counter sets status=declined', greenOfferRow.status === 'declined', JSON.stringify(greenOfferRow));

  const greenOhByStranger = await C.call('POST', `/api/green-homes/${GREEN}/open-houses`, { startsAt: new Date(Date.now() + 48 * 3600000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600000).toISOString() });
  record('green', "a non-owner can't schedule an open house", denied(greenOhByStranger), `status ${greenOhByStranger.status}`);
  const greenOhCreate = await A.call('POST', `/api/green-homes/${GREEN}/open-houses`, { startsAt: new Date(Date.now() + 48 * 3600000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600000).toISOString(), note: 'AUTHZ open house' });
  record('green', 'owner can schedule an open house', greenOhCreate.status === 201, `status ${greenOhCreate.status}`);
  const GREEN_OH = greenOhCreate.json && greenOhCreate.json.id;
  const greenRsvp = await B.call('POST', `/api/green-homes/${GREEN}/open-houses/${GREEN_OH}/rsvp`, {});
  record('green', 'a signed-in user can RSVP', greenRsvp.json && greenRsvp.json.going === true, JSON.stringify(greenRsvp.json));
  const greenOhDeleteByStranger = await C.call('DELETE', `/api/green-homes/${GREEN}/open-houses/${GREEN_OH}`);
  record('green', "a non-owner can't cancel someone else's open house", denied(greenOhDeleteByStranger), `status ${greenOhDeleteByStranger.status}`);

  const greenFavOn = await C.call('PUT', `/api/green-homes/${GREEN}/favorite`, {});
  record('green', 'a user can favorite the listing', greenFavOn.json && greenFavOn.json.favorited === true, JSON.stringify(greenFavOn.json));
  const greenFavList = (await C.call('GET', '/api/green-homes?favorites=1')).json.homes;
  record('green', 'favorited home shows up in favorites list', greenFavList.some(h => h.id === GREEN), JSON.stringify(greenFavList.map(h => h.id)));
  const greenPriceDrop = await A.call('PUT', `/api/green-homes/${GREEN}`, { ...greenBody, askingPrice: 660000, lifeEventTags: ['relocation'] });
  record('green', 'owner can drop the price again', greenPriceDrop.status === 200, `status ${greenPriceDrop.status}`);
  const cNotifGreenPriceDrop = sql(`SELECT body FROM notifications WHERE user_id = ${C.id} AND body LIKE '%dropped in price%'`);
  record('green', 'favoriter is notified of the price drop', cNotifGreenPriceDrop.length > 0, JSON.stringify(cNotifGreenPriceDrop));

  const greenStatus = await A.call('PUT', `/api/green-homes/${GREEN}`, { action: 'set-status', status: 'under_contract' });
  record('green', 'the owner can change their own listing status', greenStatus.status === 200 && sql(`SELECT status FROM green_homes WHERE id = ${GREEN}`)[0].status === 'under_contract', `status ${greenStatus.status}`);
  const greenPublicAfter = await anon.call('GET', `/green-home/${GREEN}`);
  record('green', 'a no-longer-active listing drops off its public share page too', greenPublicAfter.status === 404, `status ${greenPublicAfter.status}`);
  const greenBrowseAfter = (await B.call('GET', '/api/green-homes')).json.homes;
  record('green', 'a listing no longer active drops out of the public browse list', !greenBrowseAfter.some(h => h.id === GREEN), JSON.stringify(greenBrowseAfter.map(h => h.id)));

  // ---------- FinderMine ----------
  console.log('\n== findermine ==');
  const projBody = { title: 'AUTHZ Dev Project', city: 'San Diego', state: 'CA', address: MARK.projAddress, projectType: 'multifamily', stage: 'permitting',
    fundingGoal: 900000, minInvestment: 25000, targetReturn: '14% IRR', timelineMonths: 14, description: 'authz project',
    adaptations: ['roll_in_shower', 'not_a_real_key'], greenFeatures: ['solar_panels', 'not_a_real_feature'] };
  const projCreate = await C.call('POST', '/api/dev-projects', projBody);
  const PROJ = projCreate.json && projCreate.json.id;
  record('findermine', 'a developer can post a project', projCreate.status === 201, `status ${projCreate.status} ${projCreate.text.slice(0, 100)}`);
  const projAdaptCheck = (await C.call('GET', `/api/dev-projects/${PROJ}`)).json;
  record('findermine', 'adaptations are optional on a project; a bogus key is filtered, a valid one kept', JSON.stringify(projAdaptCheck.project.adaptations) === JSON.stringify(['roll_in_shower']), JSON.stringify(projAdaptCheck.project.adaptations));
  record('findermine', 'green features are optional on a project; a bogus key is filtered, a valid one kept', JSON.stringify(projAdaptCheck.project.greenFeatures) === JSON.stringify(['solar_panels']), JSON.stringify(projAdaptCheck.project.greenFeatures));
  const projAdaptFilterHit = (await B.call('GET', '/api/dev-projects?adaptation=roll_in_shower')).json.projects;
  record('findermine', 'the adaptation filter includes a matching project', projAdaptFilterHit.some(p => p.id === PROJ), JSON.stringify(projAdaptFilterHit.map(p => p.id)));
  const projAdaptFilterMiss = (await B.call('GET', '/api/dev-projects?adaptation=hearing_impairment_features')).json.projects;
  record('findermine', 'the adaptation filter excludes a non-matching project', !projAdaptFilterMiss.some(p => p.id === PROJ), JSON.stringify(projAdaptFilterMiss.map(p => p.id)));
  const projGreenFilterHit = (await B.call('GET', '/api/dev-projects?greenFeature=solar_panels')).json.projects;
  record('findermine', 'the green feature filter includes a matching project', projGreenFilterHit.some(p => p.id === PROJ), JSON.stringify(projGreenFilterHit.map(p => p.id)));
  const projGreenFilterMiss = (await B.call('GET', '/api/dev-projects?greenFeature=geothermal')).json.projects;
  record('findermine', 'the green feature filter excludes a non-matching project', !projGreenFilterMiss.some(p => p.id === PROJ), JSON.stringify(projGreenFilterMiss.map(p => p.id)));
  const projBadType = await C.call('POST', '/api/dev-projects', { ...projBody, projectType: 'not-a-real-type' });
  record('findermine', 'an invalid project type is refused', projBadType.status === 400, `status ${projBadType.status}`);
  const projAsOwner = (await C.call('GET', `/api/dev-projects/${PROJ}`)).json || {};
  record('findermine', 'the owner sees the private address and the (empty) interested-investor list', projAsOwner.isOwner === true && projAsOwner.project.address === MARK.projAddress && Array.isArray(projAsOwner.interestedInvestors), JSON.stringify(projAsOwner.project && Object.keys(projAsOwner.project)));
  const projAsB = await B.call('GET', `/api/dev-projects/${PROJ}`);
  const projB = projAsB.json || {};
  record('findermine', 'a non-owner never sees the address or the interested-investor list', projAsB.status === 200 && projB.project.address === undefined && projB.interestedInvestors === null && !projAsB.text.includes(MARK.projAddress), `keys=${Object.keys(projB.project || {}).join(',')}`);
  record('findermine', "a non-owner's own interest state starts false", projB.amInterested === false, JSON.stringify(projB.amInterested));
  await chk('findermine', "a non-owner can't change the project status", 'PUT', `/api/dev-projects/${PROJ}`, { action: 'set-status', status: 'funded' });
  await chk('findermine', "a non-owner can't delete the project", 'DELETE', `/api/dev-projects/${PROJ}`);
  const interestOn = await B.call('POST', `/api/dev-projects/${PROJ}/interest`, { note: 'AUTHZ interested' });
  record('findermine', 'expressing interest succeeds and is reflected back', interestOn.json && interestOn.json.interested === true, JSON.stringify(interestOn.json));
  const cNotifInterest = sql(`SELECT body FROM notifications WHERE user_id = ${C.id} AND body LIKE '%interested in your FinderMine project%'`);
  record('findermine', 'the project owner is notified of the new interest', cNotifInterest.length > 0, JSON.stringify(cNotifInterest));
  const projAfterInterest = (await C.call('GET', `/api/dev-projects/${PROJ}`)).json;
  record('findermine', "the owner's investor list shows the interested user, by name", projAfterInterest.interestedInvestors.length === 1 && projAfterInterest.interestedInvestors[0].user_id === B.id, JSON.stringify(projAfterInterest.interestedInvestors));
  const projAsBAfter = (await B.call('GET', `/api/dev-projects/${PROJ}`)).json;
  record('findermine', "the interested user's own view now shows amInterested true", projAsBAfter.amInterested === true, JSON.stringify(projAsBAfter.amInterested));
  const interestOff = await B.call('POST', `/api/dev-projects/${PROJ}/interest`, {});
  record('findermine', 'withdrawing interest flips it back off', interestOff.json && interestOff.json.interested === false, JSON.stringify(interestOff.json));
  const projAfterWithdraw = (await C.call('GET', `/api/dev-projects/${PROJ}`)).json;
  record('findermine', 'withdrawn interest disappears from the owner\'s investor list too', projAfterWithdraw.interestedInvestors.length === 0, JSON.stringify(projAfterWithdraw.interestedInvestors));
  const projPublicPage = await anon.call('GET', `/project/${PROJ}`);
  record('findermine', 'the public share page is visible while open, anonymously', projPublicPage.status === 200 && projPublicPage.text.includes('AUTHZ Dev Project'), `status ${projPublicPage.status}`);
  record('findermine', "the public share page never leaks the street address", !projPublicPage.text.includes(MARK.projAddress), '');
  const projPublic404 = await anon.call('GET', '/project/999999999');
  record('findermine', 'the public share page 404s for a bogus id', projPublic404.status === 404, `status ${projPublic404.status}`);

  // ---------- FinderMine: favorites + needs-alerts ----------
  const projFavOn = await B.call('PUT', `/api/dev-projects/${PROJ}/favorite`, {});
  record('findermine', 'a user can favorite a project', projFavOn.json && projFavOn.json.favorited === true, JSON.stringify(projFavOn.json));
  const projFavList = (await B.call('GET', '/api/dev-projects?favorites=1')).json.projects;
  record('findermine', 'favorited project shows up in favorites list', projFavList.some(p => p.id === PROJ), JSON.stringify(projFavList.map(p => p.id)));
  const projFavOff = await B.call('PUT', `/api/dev-projects/${PROJ}/favorite`, {});
  record('findermine', 'toggling favorite again removes it', projFavOff.json && projFavOff.json.favorited === false, JSON.stringify(projFavOff.json));

  const projAlertNoCriteria = await H.call('POST', '/api/dev-project-needs-alerts', { label: 'x' });
  record('findermine', 'an alert with no type/city/state is refused', projAlertNoCriteria.status === 400, `status ${projAlertNoCriteria.status}`);
  const projAlertCreate = await H.call('POST', '/api/dev-project-needs-alerts', { label: 'AUTHZ project alert', projectType: 'multifamily', city: 'San Diego', state: 'CA' });
  const PROJ_ALERT = projAlertCreate.json && projAlertCreate.json.id;
  record('findermine', 'a user can save a project needs-alert', projAlertCreate.status === 201, `status ${projAlertCreate.status}`);
  const projMatch = await C.call('POST', '/api/dev-projects', { ...projBody, title: 'AUTHZ Dev Project 2', address: '' });
  const hNotifAfterProjMatch = sql(`SELECT body FROM notifications WHERE user_id = ${H.id} AND body LIKE 'A new FinderMine project%AUTHZ project alert%'`);
  record('findermine', "posting a newly-matching project notifies the saved alert's owner", hNotifAfterProjMatch.length > 0, JSON.stringify(hNotifAfterProjMatch));
  await C.call('DELETE', `/api/dev-project-needs-alerts/${PROJ_ALERT}`);
  const projAlertsAfterAttempt = (await H.call('GET', '/api/dev-project-needs-alerts')).json.alerts;
  record('findermine', "another user cannot delete someone else's project alert", projAlertsAfterAttempt.some(a => a.id === PROJ_ALERT), JSON.stringify(projAlertsAfterAttempt.map(a => a.id)));
  await H.call('DELETE', `/api/dev-project-needs-alerts/${PROJ_ALERT}`);
  const projAlertsAfterOwn = (await H.call('GET', '/api/dev-project-needs-alerts')).json.alerts;
  record('findermine', "the alert's own owner can delete it", !projAlertsAfterOwn.some(a => a.id === PROJ_ALERT), JSON.stringify(projAlertsAfterOwn.map(a => a.id)));

  const projStatus = await C.call('PUT', `/api/dev-projects/${PROJ}`, { action: 'set-status', status: 'funded' });
  record('findermine', 'the owner can mark their own project funded', projStatus.status === 200 && sql(`SELECT status FROM dev_projects WHERE id = ${PROJ}`)[0].status === 'funded', `status ${projStatus.status}`);
  const projBrowseAfter = (await B.call('GET', '/api/dev-projects')).json.projects;
  record('findermine', 'a funded project drops out of the open browse list', !projBrowseAfter.some(p => p.id === PROJ), JSON.stringify(projBrowseAfter.map(p => p.id)));
  const projPublicAfter = await anon.call('GET', `/project/${PROJ}`);
  record('findermine', 'a no-longer-open project drops off its public share page too', projPublicAfter.status === 404, `status ${projPublicAfter.status}`);

  // ---------- public profile pages (server-rendered, functions/profile/[id].js) ----------
  console.log('\n== public profile pages ==');
  const agentProfilePage = await anon.call('GET', `/profile/${G.id}`);
  record('profile', 'anonymous can view an approved agent\'s profile page', agentProfilePage.status === 200 && agentProfilePage.text.includes('Authz agent1'), `status ${agentProfilePage.status}`);
  record('profile', 'the agent profile page title is per-agent, not the old generic shell', /<title>Authz agent1,.*Amico Haus<\/title>/.test(agentProfilePage.text), '');
  const userProfilePage = await anon.call('GET', `/profile/${A.id}`);
  record('profile', 'anonymous can view a regular user\'s profile page', userProfilePage.status === 200 && userProfilePage.text.includes('Authz homeowner'), `status ${userProfilePage.status}`);
  const missingProfilePage = await anon.call('GET', '/profile/99999999');
  record('profile', 'a nonexistent profile id is a real 404', missingProfilePage.status === 404, `status ${missingProfilePage.status}`);
  record('profile', 'the public agent profile page never renders the admin-only applied/reviewed/rejection fields', !/appliedAt|reviewedAt|rejectionReason|notifyNewRequests/.test(agentProfilePage.text), '');

  // ---------- listing offers & open houses (regular trade listings, functions/api/listings/[id]/*) ----------
  console.log('\n== listing offers & open houses ==');
  const offerByOwner = await A.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 500000 });
  record('offers', "the listing owner can't make an offer on their own listing", offerByOwner.status === 400, `status ${offerByOwner.status}`);
  const offerCreate = await B.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 575000, financingType: 'cash', closingTimeline: '14 days', contingencies: 'none', message: MARK.offerMessage });
  record('offers', 'a non-owner can submit an offer', offerCreate.status === 201, `status ${offerCreate.status} ${offerCreate.text.slice(0, 100)}`);
  const OFFER = offerCreate.json && offerCreate.json.id;
  const dupeOffer = await B.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 550000 });
  record('offers', 'the same buyer cannot have two pending offers on one listing', dupeOffer.status === 400, `status ${dupeOffer.status}`);

  const ownerOffers = await A.call('GET', `/api/listings/${LA}/offers`);
  record('offers', 'the listing owner sees the offer with full terms', ownerOffers.json.isOwner === true && ownerOffers.json.offers.length === 1 && ownerOffers.json.offers[0].offerPrice === 575000, JSON.stringify(ownerOffers.json.offers));
  const strangerOffers = await C.call('GET', `/api/listings/${LA}/offers`);
  record('offers', "a non-owner, non-buyer sees neither the list, nor B's offer price or message", strangerOffers.json.isOwner === false && strangerOffers.json.myOffer === null && !strangerOffers.text.includes('575000') && !strangerOffers.text.includes(MARK.offerMessage), JSON.stringify(strangerOffers.json));
  const buyerOwnOffer = await B.call('GET', `/api/listings/${LA}/offers`);
  record('offers', "the buyer sees only their own offer, not an owner-style list", buyerOwnOffer.json.isOwner === false && buyerOwnOffer.json.myOffer && buyerOwnOffer.json.myOffer.id === OFFER, JSON.stringify(buyerOwnOffer.json));

  const acceptByStranger = await C.call('PUT', `/api/listings/${LA}/offers/${OFFER}`, { action: 'accept' });
  record('offers', "an unrelated user can't accept someone else's offer", denied(acceptByStranger), `status ${acceptByStranger.status}`);
  const acceptByBuyer = await B.call('PUT', `/api/listings/${LA}/offers/${OFFER}`, { action: 'accept' });
  record('offers', "the buyer can't accept their own offer (only the listing owner can; the buyer can only withdraw)", denied(acceptByBuyer), `status ${acceptByBuyer.status}`);
  const withdrawByStranger = await C.call('PUT', `/api/listings/${LA}/offers/${OFFER}`, { action: 'withdraw' });
  record('offers', "an unrelated user can't withdraw someone else's offer", denied(withdrawByStranger), `status ${withdrawByStranger.status}`);
  const accept = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER}`, { action: 'accept' });
  record('offers', 'the owner can accept the offer', accept.status === 200, `status ${accept.status}`);
  const reDecide = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER}`, { action: 'decline' });
  record('offers', "an already-decided offer can't be decided again", reDecide.status === 400, `status ${reDecide.status}`);

  // ---------- offer counter-proposals ----------
  console.log('\n== offer counter-proposals ==');
  const offer2Create = await H.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 560000, financingType: 'financed' });
  const OFFER2 = offer2Create.json && offer2Create.json.id;
  record('counter', 'a second buyer can submit a fresh offer', offer2Create.status === 201, `status ${offer2Create.status}`);
  const counterByStranger = await C.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'counter', counterPrice: 600000 });
  record('counter', "a non-owner can't counter someone else's offer", denied(counterByStranger), `status ${counterByStranger.status}`);
  const counterByBuyer = await H.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'counter', counterPrice: 600000 });
  record('counter', "the buyer can't counter their own offer (only the owner can)", denied(counterByBuyer), `status ${counterByBuyer.status}`);
  const counterOk = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'counter', counterPrice: 600000, counterMessage: MARK.counterMessage });
  record('counter', 'the owner can counter a pending offer', counterOk.status === 200 && sql(`SELECT status, counter_price FROM listing_offers WHERE id = ${OFFER2}`)[0].status === 'countered', `status ${counterOk.status}`);
  const counterAgain = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'counter', counterPrice: 610000 });
  record('counter', "the owner can't counter an already-countered offer", counterAgain.status === 400, `status ${counterAgain.status}`);
  const acceptCounteredDirect = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'accept' });
  record('counter', "the owner can't short-circuit their own counter with a plain accept", acceptCounteredDirect.status === 400, `status ${acceptCounteredDirect.status}`);
  const acceptCounterByOwner = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'accept_counter' });
  record('counter', "the owner can't accept_counter (that's the buyer's decision)", denied(acceptCounterByOwner), `status ${acceptCounterByOwner.status}`);
  const acceptCounterByStranger = await C.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'accept_counter' });
  record('counter', "an unrelated user can't accept someone else's counter", denied(acceptCounterByStranger), `status ${acceptCounterByStranger.status}`);
  const buyerSeesCounter = await H.call('GET', `/api/listings/${LA}/offers`);
  record('counter', "the buyer's own view shows the counter price and message", buyerSeesCounter.json.myOffer && buyerSeesCounter.json.myOffer.status === 'countered' && buyerSeesCounter.json.myOffer.counterPrice === 600000 && buyerSeesCounter.json.myOffer.counterMessage === MARK.counterMessage, JSON.stringify(buyerSeesCounter.json.myOffer));
  const acceptCounter = await H.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'accept_counter' });
  const offer2Row = sql(`SELECT status, offer_price, counter_price FROM listing_offers WHERE id = ${OFFER2}`)[0];
  record('counter', 'the buyer can accept the counter, which sets offer_price to the counter price', acceptCounter.status === 200 && offer2Row.status === 'accepted' && offer2Row.offer_price === offer2Row.counter_price, `status ${acceptCounter.status} row=${JSON.stringify(offer2Row)}`);
  const acceptCounterTwice = await H.call('PUT', `/api/listings/${LA}/offers/${OFFER2}`, { action: 'accept_counter' });
  record('counter', "an already-accepted counter can't be accepted again", acceptCounterTwice.status === 400, `status ${acceptCounterTwice.status}`);

  const offer3Create = await G.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 540000 });
  const OFFER3 = offer3Create.json && offer3Create.json.id;
  await A.call('PUT', `/api/listings/${LA}/offers/${OFFER3}`, { action: 'counter', counterPrice: 555000, counterMessage: 'best I can do' });
  const declineCounterByOwner = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER3}`, { action: 'decline_counter' });
  record('counter', "the owner can't decline_counter (that's the buyer's decision)", denied(declineCounterByOwner), `status ${declineCounterByOwner.status}`);
  const declineCounter = await G.call('PUT', `/api/listings/${LA}/offers/${OFFER3}`, { action: 'decline_counter' });
  record('counter', 'the buyer can decline the counter', declineCounter.status === 200 && sql(`SELECT status FROM listing_offers WHERE id = ${OFFER3}`)[0].status === 'declined', `status ${declineCounter.status}`);

  // ---------- multi-round: the buyer can counter back, any number of times, not just accept/decline ----------
  const dupeWhilePending = await H.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 561000 });
  record('counter', "a buyer with an already-accepted offer can still submit a fresh one on the same listing", dupeWhilePending.status === 201, `status ${dupeWhilePending.status}`);
  const offer4Create = await G.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 530000 });
  const OFFER4 = offer4Create.json && offer4Create.json.id;
  const dupeWhilePending2 = await G.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 531000 });
  record('counter', "a buyer can't submit a second offer while one is pending", dupeWhilePending2.status === 400, `status ${dupeWhilePending2.status}`);
  const round1 = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER4}`, { action: 'counter', counterPrice: 560000, counterMessage: 'round 1' });
  record('counter', 'round 1: owner counters the pending offer', round1.status === 200, `status ${round1.status}`);
  let offer4Row = sql(`SELECT status, countered_by FROM listing_offers WHERE id = ${OFFER4}`)[0];
  record('counter', 'after round 1: countered_by=owner', offer4Row.countered_by === 'owner', JSON.stringify(offer4Row));
  const dupeWhileCountered = await G.call('POST', `/api/listings/${LA}/offers`, { offerPrice: 532000 });
  record('counter', "a buyer can't submit a second offer while one is countered (still in progress)", dupeWhileCountered.status === 400, `status ${dupeWhileCountered.status}`);
  const ownerCounterTooSoon = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER4}`, { action: 'counter', counterPrice: 565000 });
  record('counter', "the owner can't counter again before the buyer responds", ownerCounterTooSoon.status >= 400 && ownerCounterTooSoon.status < 500, `status ${ownerCounterTooSoon.status}`);
  const round2 = await G.call('PUT', `/api/listings/${LA}/offers/${OFFER4}`, { action: 'counter', counterPrice: 540000, counterMessage: 'round 2' });
  record('counter', 'round 2: the buyer counters back instead of accept/decline', round2.status === 200, `status ${round2.status}`);
  offer4Row = sql(`SELECT status, countered_by, counter_price FROM listing_offers WHERE id = ${OFFER4}`)[0];
  record('counter', 'after round 2: countered_by=buyer, price updated to the buyer\'s number', offer4Row.countered_by === 'buyer' && offer4Row.counter_price === 540000, JSON.stringify(offer4Row));
  const buyerCounterTooSoon = await G.call('PUT', `/api/listings/${LA}/offers/${OFFER4}`, { action: 'counter', counterPrice: 545000 });
  record('counter', "the buyer can't counter again before the owner responds", buyerCounterTooSoon.status >= 400 && buyerCounterTooSoon.status < 500, `status ${buyerCounterTooSoon.status}`);
  const strangerCounterRound2 = await C.call('PUT', `/api/listings/${LA}/offers/${OFFER4}`, { action: 'counter', counterPrice: 900000 });
  record('counter', "an unrelated user can't counter at any round", denied(strangerCounterRound2), `status ${strangerCounterRound2.status}`);
  const round3 = await A.call('PUT', `/api/listings/${LA}/offers/${OFFER4}`, { action: 'counter', counterPrice: 550000, counterMessage: 'round 3, final' });
  record('counter', 'round 3: the owner counters back again', round3.status === 200, `status ${round3.status}`);
  const acceptRound3 = await G.call('PUT', `/api/listings/${LA}/offers/${OFFER4}`, { action: 'accept_counter' });
  offer4Row = sql(`SELECT status, offer_price, counter_price FROM listing_offers WHERE id = ${OFFER4}`)[0];
  record('counter', 'the buyer accepts the 3rd-round counter, final price matches it', acceptRound3.status === 200 && offer4Row.status === 'accepted' && offer4Row.offer_price === 550000 && offer4Row.offer_price === offer4Row.counter_price, `status ${acceptRound3.status} row=${JSON.stringify(offer4Row)}`);

  const ohCreateByStranger = await B.call('POST', `/api/listings/${LA}/open-houses`, { startsAt: new Date(Date.now() + 48 * 3600000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600000).toISOString() });
  record('open-house', "a non-owner can't schedule an open house on someone else's listing", denied(ohCreateByStranger), `status ${ohCreateByStranger.status}`);
  const ohCreate = await A.call('POST', `/api/listings/${LA}/open-houses`, { startsAt: new Date(Date.now() + 48 * 3600000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600000).toISOString(), note: 'AUTHZ open house' });
  record('open-house', 'the owner can schedule an open house', ohCreate.status === 201, `status ${ohCreate.status}`);
  const OH = ohCreate.json && ohCreate.json.id;
  const ohListAnon = await anon.call('GET', `/api/listings/${LA}/open-houses`);
  record('open-house', 'open houses are publicly visible (anonymous)', ohListAnon.status === 200 && ohListAnon.json.openHouses.some(o => o.id === OH), JSON.stringify(ohListAnon.json));
  const rsvpAnon = await anon.call('POST', `/api/listings/${LA}/open-houses/${OH}/rsvp`, {});
  record('open-house', "anonymous can't RSVP", rsvpAnon.status === 401, `status ${rsvpAnon.status}`);
  const rsvpB = await B.call('POST', `/api/listings/${LA}/open-houses/${OH}/rsvp`, {});
  record('open-house', 'a signed-in user can RSVP', rsvpB.json && rsvpB.json.going === true, JSON.stringify(rsvpB.json));
  const ohDeleteByStranger = await B.call('DELETE', `/api/listings/${LA}/open-houses/${OH}`);
  record('open-house', "a non-owner can't cancel someone else's open house", denied(ohDeleteByStranger), `status ${ohDeleteByStranger.status}`);

  const favoriteByC = await C.call('PUT', `/api/listings/${LA}/feedback`, { feedback: 'up' });
  record('open-house', 'a user can favorite a listing', favoriteByC.status === 200, `status ${favoriteByC.status}`);
  const oh2Create = await A.call('POST', `/api/listings/${LA}/open-houses`, { startsAt: new Date(Date.now() + 72 * 3600000).toISOString(), endsAt: new Date(Date.now() + 74 * 3600000).toISOString(), note: 'AUTHZ open house 2' });
  record('open-house', 'the owner can schedule a second open house', oh2Create.status === 201, `status ${oh2Create.status}`);
  await new Promise(r => setTimeout(r, 500));
  const cNotifOpenHouse = sql(`SELECT body FROM notifications WHERE user_id = ${C.id} AND body LIKE '%open house%saved%'`);
  record('open-house', 'a favoriter is notified when a new open house is scheduled', cNotifOpenHouse.length > 0, JSON.stringify(cNotifOpenHouse));
  const bNotifOpenHouse2 = sql(`SELECT body FROM notifications WHERE user_id = ${B.id} AND body LIKE '%open house%saved%'`);
  record('open-house', "a non-favoriter isn't notified about a new open house", bNotifOpenHouse2.length === 0, JSON.stringify(bNotifOpenHouse2));

  // ---------- pre-listing delete: awarded protection (PL is awarded from setup) ----------
  const deleteAwarded = await A.call('DELETE', `/api/pre-listings/${PL}`);
  record('owner', "an awarded pre-listing can't be deleted, same protection as closing/editing", deleteAwarded.status === 400 && sql(`SELECT COUNT(*) AS n FROM pre_listings WHERE id = ${PL}`)[0].n === 1, `status ${deleteAwarded.status}`);
  const deletePL2ByStranger = await B.call('DELETE', `/api/pre-listings/${PL2}`);
  record('owner', "a non-owner can't delete A's closed pre-listing", denied(deletePL2ByStranger) && sql(`SELECT COUNT(*) AS n FROM pre_listings WHERE id = ${PL2}`)[0].n === 1, `status ${deletePL2ByStranger.status}`);
  const deletePL2 = await A.call('DELETE', `/api/pre-listings/${PL2}`);
  record('owner', 'the owner can delete their own closed pre-listing', deletePL2.status === 200 && sql(`SELECT COUNT(*) AS n FROM pre_listings WHERE id = ${PL2}`)[0].n === 0, `status ${deletePL2.status}`);

  // ---------- deal threads (per-listing discussion, the Reddit/BiggerPockets-style comment thread) ----------
  console.log('\n== deal threads ==');
  const threadAnon = await anon.call('GET', `/api/listings/${LA}/thread`);
  record('deal-thread', "anonymous can read a listing's deal thread (public like the listing page itself)", threadAnon.status === 200 && Number.isInteger(threadAnon.json.postId), JSON.stringify(threadAnon.json));
  const THREAD_POST = threadAnon.json.postId;
  const threadAgain = await B.call('GET', `/api/listings/${LA}/thread`);
  record('deal-thread', 'fetching the same thread again returns the same anchor post, not a duplicate', threadAgain.json.postId === THREAD_POST, JSON.stringify(threadAgain.json));

  const threadAugAnon = await anon.call('GET', `/api/augmented-homes/${AUG}/thread`);
  record('deal-thread', "anonymous can't read an AugmentedHome's thread (no public offer UI for this vertical either, sign-in required)", threadAugAnon.status === 401, `status ${threadAugAnon.status}`);
  const threadAugB = await B.call('GET', `/api/augmented-homes/${AUG}/thread`);
  record('deal-thread', "a signed-in stranger CAN read an AugmentedHome's thread", threadAugB.status === 200 && Number.isInteger(threadAugB.json.postId), JSON.stringify(threadAugB.json));
  const threadGreenAnon = await anon.call('GET', `/api/green-homes/${GREEN}/thread`);
  record('deal-thread', "anonymous can't read a GreenHome's thread", threadGreenAnon.status === 401, `status ${threadGreenAnon.status}`);
  const threadProjAnon = await anon.call('GET', `/api/dev-projects/${PROJ}/thread`);
  record('deal-thread', "anonymous can't read a FinderMine project's thread", threadProjAnon.status === 401, `status ${threadProjAnon.status}`);

  const commentAnonPost = await anon.call('POST', `/api/posts/${THREAD_POST}/comments`, { body: 'anon trying to post' });
  record('deal-thread', "anonymous can't post a comment on a deal thread", commentAnonPost.status === 401, `status ${commentAnonPost.status}`);
  // B, not C: A already blocked C in the "blocks" section above, so C can't post on A's thread at all (checked
  // separately below) -- B is unblocked and is the right actor for the generic "can post" / "anon can read" checks.
  const commentB = await B.call('POST', `/api/posts/${THREAD_POST}/comments`, { body: MARK.comment + '-thread' });
  record('deal-thread', 'a signed-in user can post a comment on the deal thread', commentB.status === 201, `status ${commentB.status}`);
  const THREAD_COMMENT = commentB.json && commentB.json.id;
  const threadCommentsAnon = await anon.call('GET', `/api/posts/${THREAD_POST}/comments`);
  record('deal-thread', 'anonymous can read the comment back', threadCommentsAnon.status === 200 && threadCommentsAnon.json.comments.some(c => c.id === THREAD_COMMENT), JSON.stringify(threadCommentsAnon.json));
  // A already blocked C (see the "blocks" section above) -- a deal-thread comment is a comment like any other,
  // so that same existing block-enforcement must carry over to the new entity-linked posts without new logic:
  // C can't even post on A's thread (comments.js refuses the party, same as it would on any other post of A's).
  const commentCBlocked = await C.call('POST', `/api/posts/${THREAD_POST}/comments`, { body: 'should never land' });
  record('deal-thread', "a user A has blocked can't comment on A's deal thread at all", denied(commentCBlocked), `status ${commentCBlocked.status}`);

  // The anchor post (empty body, entity FK set) must never leak into the general feed -- it's reachable
  // only through its entity's own thread.
  const feedCheck = await A.call('GET', '/api/posts');
  record('deal-thread', "the deal-thread anchor post never appears in the general feed", !feedCheck.json.posts.some(p => p.id === THREAD_POST), JSON.stringify(feedCheck.json.posts.map(p => p.id)));

  // ---------- market pulse (real-event ticker) ----------
  console.log('\n== market pulse ==');
  const eventsAnon = await anon.call('GET', '/api/market-events');
  record('market-pulse', "anonymous can't read market events (signed-in only, like the rest of the app)", eventsAnon.status === 401, `status ${eventsAnon.status}`);
  const priceDrop = await A.call('PUT', `/api/listings/${LA}`, { action: 'edit', ...listingBody({ estimatedValue: 575000 }) });
  record('market-pulse', 'the owner can edit their listing to a lower price (triggers a price_drop event)', priceDrop.status === 200, `status ${priceDrop.status}`);
  await new Promise(r => setTimeout(r, 500));
  const eventsB = await B.call('GET', '/api/market-events?limit=50');
  const dropEvent = eventsB.json && eventsB.json.events && eventsB.json.events.find(e => e.entityKind === 'listing' && e.entityId === LA && e.eventType === 'price_drop');
  record('market-pulse', 'a real price drop shows up in the market-events feed for any signed-in user, with the right delta', eventsB.status === 200 && !!dropEvent && dropEvent.delta === -25000, JSON.stringify(dropEvent));

  // ---------- 5. leak scan: everything B, H and anonymous can GET, grepped for planted secrets ----------
  console.log('\n== leak scan ==');
  const urls = ['/api/me', '/api/directory', '/api/matches', '/api/listings', `/api/listings/${LA}`, `/api/users/${A.id}`, `/api/users/${C.id}`, '/api/pre-listings', `/api/pre-listings/${PL}`,
    `/api/pre-listings/${PL}/photos`, `/api/pre-listings/${PL}/votes`, '/api/transactions', `/api/transactions/${T}`, '/api/agents/directory', `/api/agents/${G.id}`, '/api/agents/service-estimates',
    '/api/groups', '/api/groups/1', '/api/groups/2', '/api/posts', `/api/posts/${P}/comments`, '/api/conversations', '/api/notifications', '/api/favorites', '/api/hidden-listings',
    '/api/saved-searches', '/api/agent-search-alerts', '/api/referrals', '/api/demo-overview', '/api/broker/stats', '/api/agents/my-bids', '/api/agents/my-invites', '/api/agents/favorites', `/sitemap.xml`,
    '/api/augmented-homes', `/api/augmented-homes/${AUG}`, '/api/accessibility-needs-alerts', '/api/dev-projects', `/api/dev-projects/${PROJ}`,
    '/api/green-homes', `/api/green-homes/${GREEN}`,
    `/profile/${G.id}`, `/profile/${A.id}`, `/api/listings/${LA}/offers`, `/api/listings/${LA}/open-houses`, `/listing/${LA}`,
    `/api/listings/${LA}/thread`, `/api/posts/${THREAD_POST}/comments`, '/api/market-events'];
  const secrets = [['client name', MARK.clientName], ['listing address', MARK.address], ['pre-listing address', MARK.preAddress], ['lockbox note (non-agent)', MARK.lockbox], ['private message', MARK.message],
    ['augmented home address', MARK.augAddress], ['dev project address', MARK.projAddress], ['green home address', MARK.greenAddress], ['counter-offer message', MARK.counterMessage],
    ['A email', A.email], ['C email', C.email], ['password hash', 'password_hash'], ['verify token', 'verify_token'], ['reset token', 'reset_token'], ['R2 key', 'r2_key'], ['session', 'ah_session']];
  for (const who of [B, anon]) {
    for (const url of urls) {
      const r = await who.call('GET', url);
      for (const [name, needle] of secrets) {
        if (name === 'lockbox note (non-agent)' && who === H) continue;
        if (r.text.includes(needle)) record('leak', `${who.role} response to GET ${url} contains ${name}`, false, needle);
      }
    }
  }
  record('leak', `scanned ${urls.length} endpoints as attacker and anonymous for ${secrets.length} kinds of secret`, !findings.some(f => f.startsWith('[leak]')), '');

  // ---------- collect ids for cleanup ----------
  writeCleanupFile();

  console.log(`\n${results.length} checks, ${findings.length} failed`);
  if (findings.length) { console.log('\nFAILURES:'); findings.forEach(f => console.log('  - ' + f)); }
  console.log('\ncleanup file written: authz_cleanup.json');
})().catch(e => {
  console.error('HARNESS ERROR', e);
  try { console.error(`cleanup file written for ${writeCleanupFile()} test account(s): run authz-cleanup.js`); } catch (e2) { console.error('could not write the cleanup file:', e2.message); }
  process.exit(2);
});
