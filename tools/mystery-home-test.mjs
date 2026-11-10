// Mystery Home Monday (owner tools batch): runs the real handlers against an in-memory SQLite stand-in for D1 and a
// Map stand-in for R2, plus the public mystery-home.js in a vm with a fake canvas. No network.
// Checks: validation (fair housing, address, team names, 30-day rule), admin-only routes with an activity-log row on
// every write, the schedule gates, the page/photo/sitemap state over time (the sold price is in nothing served before
// the reveal), the public-page rules (no session read, cache, CSP, DRE strip, notes), the reveal labels, the share
// card (no guess, percentage or dollar figure), EXIF scrub on upload, R2 cleanup, and that the account export and
// delete never touch the admin-only mystery tables.
// Usage: node --disable-warning=ExperimentalWarning tools/mystery-home-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

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
      batchResult: async () => (/^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : stmt.run()),
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const objects = new Map();
const PHOTOS = {
  put: async (key, body) => { objects.set(key, body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : body)); },
  get: async (key) => (objects.has(key) ? { body: objects.get(key) } : null),
  head: async (key) => (objects.has(key) ? { size: objects.get(key).length } : null),
  delete: async (keys) => { for (const k of [].concat(keys)) objects.delete(k); },
};
const env = { DB, PHOTOS };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);

let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + String(detail).slice(0, 400)}`); };

// 1 admin, 2 approved agent, 3 plain homeowner.
for (const [id, role, agent, name] of [[1, 'admin', 0, 'Admin Person'], [2, 'user', 1, 'Agent Two'], [3, 'user', 0, 'Zelda Secretname']]) {
  sqlite.prepare('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)').run(id, `u${id}@example.test`, name, role);
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
  if (agent) sqlite.prepare("INSERT INTO agent_profiles (user_id, status) VALUES (?, 'approved')").run(id);
}

const call = async (handler, method, path, who, params = {}, body) => {
  const headers = who ? { Cookie: `ah_session=t${who}` } : {};
  let reqBody;
  if (body instanceof FormData) reqBody = body;
  else if (body !== undefined) { reqBody = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const request = new Request(`https://amicohaus.com${path}`, { method, headers, body: reqBody });
  const res = await handler({ request, env, params, waitUntil() {} });
  const type = res.headers.get('Content-Type') || '';
  const out = { status: res.status, headers: res.headers };
  if (type.includes('json')) out.json = await res.json();
  else if (type.includes('text') || type.includes('xml')) out.text = await res.text();
  else out.bytes = new Uint8Array(await res.arrayBuffer());
  return out;
};
console.log = () => {};

const lib = await mod('functions/_lib/mysteryHomes.js');
const homeText = await mod('functions/_lib/homeText.js');
const { escapeHtml } = await mod('functions/_lib/util.js');
const adminIndex = await mod('functions/api/admin/mystery-homes/index.js');
const adminOne = await mod('functions/api/admin/mystery-homes/[id].js');
const adminPhotos = await mod('functions/api/admin/mystery-homes/[id]/photos/index.js');
const adminPhoto = await mod('functions/api/admin/mystery-homes/[id]/photos/[photoId].js');
const photoRoute = await mod('functions/api/mystery-home-photos/[id].js');
const page = await mod('functions/mystery-home/[slug].js');
const hub = await mod('functions/mystery-home/index.js');
const sitemap = await mod('functions/sitemap.xml.js');

// ---------------------------------------------------------------- validation
const NOV20 = Date.UTC(2026, 10, 20, 20, 0);
const good = {
  source: 'own_sale', city: 'Chula Vista', state: 'CA', propertyType: 'Single Family Home', beds: 4, baths: 3, sqft: 2138,
  lotSqft: 5200, yearBuilt: 2004, highlights: 'Seismic safety straps on the water heater, a new gate and fence, and a family room with a fireplace.',
  soldPrice: 987654, soldMonth: '2026-09', sellerOkOn: '2026-11-01', brokerOkOn: '2026-11-02', photoRights: 'own',
};
const v = (patch) => lib.validateMysteryHome({ ...good, ...patch }, { nowMs: NOV20 });
check('a complete home validates (home-fact highlights like "seismic safety straps" pass)', !v({}).error && v({}).data.sold_price === 987654, JSON.stringify(v({})));
check('no city: "Add the city."', v({ city: '' }).error === 'Add the city.');
check('an unknown home type: "Pick a home type."', v({ propertyType: 'Castle' }).error === 'Pick a home type.');
check('no sale price: "Add the recorded sale price."', v({ soldPrice: null }).error === 'Add the recorded sale price.' && v({ soldPrice: 5000 }).error === 'Add the recorded sale price.');
check('a sale that closed 10 days ago is refused (30-day rule)', v({ soldMonth: '2026-11' }).error === 'The sale must have closed at least 30 days ago.');
check('steering highlights are refused with the fair-housing message', v({ highlights: 'Great for kids, near the school' }).error === homeText.STEERING_ERROR && v({ highlights: 'Safe neighborhood' }).error === homeText.STEERING_ERROR);
check('a street address in the highlights is refused', v({ highlights: 'Corner lot at 1218 La Vida Ct' }).error === 'Leave the street address out: Mystery Homes show the city only.');
check('team names / who listed it are refused', v({ highlights: 'Listed by our team' }).error === 'Leave out who listed or sold the home.' && v({ highlights: 'A McKelvey sale' }).error === 'Leave out who listed or sold the home.');
check('a written-OK date in the future is refused', /future/.test(v({ sellerOkOn: '2026-12-01' }).error || '') && /future/.test(v({ brokerOkOn: '2026-12-25' }).error || ''));
check('highlights over 400 characters are refused', !!v({ highlights: 'a'.repeat(401) }).error);
check("slugify('Chula Vista') -> chula-vista; '' -> home; 40 characters max", lib.slugify('Chula Vista') === 'chula-vista' && lib.slugify('') === 'home' && lib.slugify('!!!') === 'home' && lib.slugify('x'.repeat(60)).length === 40);

// ---------------------------------------------------------------- admin only + audit log
const nowMs = Date.now();
const iso = (h) => new Date(nowMs + h * 3600000).toISOString();
const thisMonthMinus = (m) => { const d = new Date(nowMs); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 7); };
const today = new Date(nowMs - 86400000).toISOString().slice(0, 10);
const body = { ...good, soldMonth: thisMonthMinus(3), sellerOkOn: null, brokerOkOn: null, publishAt: iso(24), revealAt: iso(72) };
let r = await call(adminIndex.onRequestPost, 'POST', '/api/admin/mystery-homes', null, {}, body);
check('POST signed out -> 401', r.status === 401);
r = await call(adminIndex.onRequestPost, 'POST', '/api/admin/mystery-homes', 2, {}, body);
check('POST as an approved agent -> 403 Admin only.', r.status === 403 && r.json.error === 'Admin only.');
r = await call(adminIndex.onRequestGet, 'GET', '/api/admin/mystery-homes', 2);
check('GET list as an agent -> 403', r.status === 403);
r = await call(adminIndex.onRequestGet, 'GET', '/api/admin/mystery-homes', null);
check('GET list signed out -> 401', r.status === 401);
r = await call(adminIndex.onRequestPost, 'POST', '/api/admin/mystery-homes', 1, {}, { ...body, highlights: 'Great for families' });
check('POST with steering highlights -> 400 with the fair-housing message', r.status === 400 && r.json.error === homeText.STEERING_ERROR);
r = await call(adminIndex.onRequestPost, 'POST', '/api/admin/mystery-homes', 1, {}, body);
check('the admin creates a draft: 201 { id, slug } with a city slug', r.status === 201 && /^chula-vista-[0-9a-f]{6}$/.test(r.json.slug) && r.headers.get('Cache-Control') === 'private, no-store', JSON.stringify(r.json));
const H = String(r.json.id);
const slug = r.json.slug;
const audits = () => sqlite.prepare("SELECT action FROM admin_audit_log WHERE target_type = 'mystery_home' ORDER BY id").all().map(a => a.action);
check('creating is on the admin activity log', audits().includes('create_mystery_home'));
for (const [label, h, method, params] of [
  ['PUT', adminOne.onRequestPut, 'PUT', { id: H }], ['DELETE', adminOne.onRequestDelete, 'DELETE', { id: H }],
  ['POST photo', adminPhotos.onRequestPost, 'POST', { id: H }], ['DELETE photo', adminPhoto.onRequestDelete, 'DELETE', { id: H, photoId: '1' }],
]) {
  const a = await call(h, method, '/x', 2, params, method === 'PUT' ? { action: 'schedule' } : undefined);
  const b = await call(h, method, '/x', null, params, method === 'PUT' ? { action: 'schedule' } : undefined);
  check(`${label}: approved agent 403, signed out 401`, a.status === 403 && b.status === 401, `${a.status} ${b.status}`);
}
r = await call(adminIndex.onRequestGet, 'GET', '/api/admin/mystery-homes', 1);
check('the admin list has the home in camelCase with its state and photos', r.status === 200 && r.json.homes[0].state === 'draft' && r.json.homes[0].soldPrice === 987654 && r.json.homes[0].stateCode === 'CA' && Array.isArray(r.json.homes[0].photos), JSON.stringify(r.json.homes[0]));

// ---------------------------------------------------------------- photos (EXIF scrub) + schedule gates
const bytes = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const str = (s) => new Uint8Array([...s].map(c => c.charCodeAt(0)));
const has = (hay, needle) => { outer: for (let i = 0; i <= hay.length - needle.length; i++) { for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer; return true; } return false; };
const seg = (marker, payload) => bytes(new Uint8Array([0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]), payload);
const scan = new Uint8Array([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0x56, 0xff, 0x00, 0x78, 0xff, 0xd9]);
const jpeg = bytes(new Uint8Array([0xff, 0xd8]),
  seg(0xe1, bytes(str('http://ns.adobe.com/xap/1.0/\0'), str('<x:xmpmeta><exif:GPSLatitude>32,37.5N</exif:GPSLatitude></x:xmpmeta>'))),
  seg(0xfe, str('shot at 123 Secret St')), seg(0xdb, new Uint8Array(65)), scan);
const upload = async (who, swept, homeId = H) => {
  const fd = new FormData();
  fd.append('photo', new File([jpeg], 'p.jpg', { type: 'image/jpeg' }));
  fd.append('swept', swept ? '1' : '0');
  return call(adminPhotos.onRequestPost, 'POST', '/x', who, { id: homeId }, fd);
};
r = await upload(1, true);
check('the admin adds a swept photo (201)', r.status === 201 && r.json.id > 0, JSON.stringify(r.json));
const p1 = r.json.id;
const key1 = sqlite.prepare('SELECT r2_key FROM mystery_home_photos WHERE id = ?').get(p1).r2_key;
check('the stored photo key is mystery/<id>/<uuid>', new RegExp(`^mystery/${H}/[0-9a-f-]{36}$`).test(key1), key1);
check('the stored file lost its GPS/XMP and comment (EXIF scrub)', !has(objects.get(key1), str('GPSLatitude')) && !has(objects.get(key1), str('Secret St')) && has(objects.get(key1), scan));
check('the swept tick is stored', !!sqlite.prepare('SELECT swept_at FROM mystery_home_photos WHERE id = ?').get(p1).swept_at);
r = await upload(1, false);
const pUnswept = r.json.id;
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { action: 'schedule' });
const missing = (r.json && r.json.missing) || [];
check('schedule with gaps -> 409 not_ready listing seller_ok, broker_ok, photos and sweep', r.status === 409 && r.json.code === 'not_ready' && r.json.error === 'Not ready to schedule yet.' &&
  ['seller_ok', 'broker_ok', 'photos', 'sweep'].every(k => missing.includes(k)) && !missing.includes('publish_at') && !missing.includes('rights'), JSON.stringify(r.json));
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { ...body, sellerOkOn: today, brokerOkOn: today, revealAt: iso(25) });
check('a field edit on a draft saves (and logs)', r.status === 200 && r.json.state === 'draft' && audits().includes('edit_mystery_home'), JSON.stringify(r.json));
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { action: 'schedule' });
check('a reveal less than 24 hours after publishing -> reveal_order', r.status === 409 && r.json.missing.includes('reveal_order') && !r.json.missing.includes('seller_ok') && !r.json.missing.includes('broker_ok'), JSON.stringify(r.json));
await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { ...body, sellerOkOn: today, brokerOkOn: today });
r = await call(adminPhoto.onRequestDelete, 'DELETE', '/x', 1, { id: H, photoId: String(pUnswept) });
const keyGoneCheck = sqlite.prepare('SELECT COUNT(*) AS n FROM mystery_home_photos WHERE id = ?').get(pUnswept).n === 0;
check('the admin removes the unswept photo (row and file gone, logged)', r.status === 200 && keyGoneCheck && objects.size === 1 && audits().includes('delete_mystery_home_photo'), `${r.status} ${objects.size}`);
r = await call(adminPhoto.onRequestDelete, 'DELETE', '/x', 1, { id: '999', photoId: String(p1) });
check('a photo id on another (unknown) home -> 404', r.status === 404);
await upload(1, true); await upload(1, true);
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { action: 'schedule' });
const row = () => sqlite.prepare('SELECT * FROM mystery_homes WHERE id = ?').get(Number(H));
check('with every gate met it schedules (still before publish: state scheduled)', r.status === 200 && r.json.state === 'scheduled' && row().status === 'scheduled', JSON.stringify(r.json));
check('scheduling sets retire_at = reveal_at + 56 days', Date.parse(row().retire_at) - Date.parse(row().reveal_at) === 56 * 86400000, `${row().reveal_at} ${row().retire_at}`);
check('scheduling is on the activity log', audits().includes('schedule_mystery_home'));
r = await upload(1, false);
check('a scheduled home refuses an unswept photo', r.status === 409 && r.json.missing.includes('sweep'));

// ---------------------------------------------------------------- state over time
const photoIds = sqlite.prepare('SELECT id FROM mystery_home_photos WHERE mystery_home_id = ? ORDER BY position').all(Number(H)).map(p => p.id);
const getPage = (who = null) => call(page.onRequestGet, 'GET', `/mystery-home/${slug}`, who, { slug });
const getPhoto = (who = null) => call(photoRoute.onRequestGet, 'GET', `/api/mystery-home-photos/${photoIds[0]}`, who, { id: String(photoIds[0]) });
const getSitemap = async () => (await call(sitemap.onRequestGet, 'GET', '/sitemap.xml', null)).text;
const priceLeaks = (html) => /987,?654|Sold for/.test(html);
r = await getPage();
check('before publish: the page is a 404 (noindex, public max-age=60, CSP)', r.status === 404 && r.text.includes('noindex') && r.headers.get('Cache-Control') === 'public, max-age=60' && !!r.headers.get('Content-Security-Policy'), r.status);
check('before publish: the 404 has no sold price', !priceLeaks(r.text));
r = await getPhoto();
check('before publish: photos 404 for the public', r.status === 404);
r = await getPhoto(2);
check('before publish: photos 404 for an approved agent too', r.status === 404);
r = await getPhoto(1);
check('before publish: the admin can preview a photo (private, no-store)', r.status === 200 && r.headers.get('Cache-Control') === 'private, no-store');
check('before publish: not in the sitemap', !(await getSitemap()).includes(slug));

// live: publish in the past, reveal ahead
sqlite.prepare('UPDATE mystery_homes SET publish_at = ?, reveal_at = ?, retire_at = ? WHERE id = ?').run(iso(-2), iso(70), iso(70 + 56 * 24), Number(H));
r = await getPage();
const liveHtml = r.text || '';
check('live: the page is 200, public max-age=60, with the CSP', r.status === 200 && r.headers.get('Cache-Control') === 'public, max-age=60' && !!r.headers.get('Content-Security-Policy'), r.status);
check('live: no sold price anywhere in the HTML (no digits of it, no "Sold for", no data-mystery-sold)', !priceLeaks(liveHtml) && !liveHtml.includes('data-mystery-sold'));
check('live: h1, the guess box with a labeled input, the game note, the permission line, the facts note', liveHtml.includes('A home that sold in Chula Vista, CA') && liveHtml.includes('<label for="mysteryGuess">Your guess</label>') &&
  liveHtml.includes(escapeHtml(lib.MYSTERY_GAME_NOTE)) && liveHtml.includes(escapeHtml(lib.MYSTERY_PERMISSION_LINE)) && liveHtml.includes(`<p class="tiny">${escapeHtml(lib.MYSTERY_FACTS_NOTE)}</p>`) && liveHtml.includes("Your guess stays on this device. We don't collect it."));
check('live: the agent strip (Rudy, DRE, CB West) and the footer tagline span', liveHtml.includes('class="agent-strip"') && liveHtml.includes('DRE #02257808') && liveHtml.includes('Coldwell Banker West') && liveHtml.includes('<span class="footer-tagline">'));
check('live: the CTA to post a pre-listing, photos with numbered alt text, og:image is the first photo', liveHtml.includes('href="/signup?as=homeowner">Thinking about your own home? Post a pre-listing</a>') && liveHtml.includes('alt="Mystery Home photo 1"') && liveHtml.includes(`og:image" content="https://amicohaus.com/api/mystery-home-photos/${photoIds[0]}"`));
check('live: loads client.js and mystery-home.js (no inline script, no JSON-LD)', liveHtml.includes('/mystery-home.js?v=') && !/<script(?![^>]*\bsrc=)[^>]*>/.test(liveHtml));
r = await getPhoto();
check('live: photos are public, max-age=300', r.status === 200 && r.headers.get('Cache-Control') === 'public, max-age=300');
check('live: in the sitemap', (await getSitemap()).includes(`/mystery-home/${slug}<`));
r = await call(hub.onRequestGet, 'GET', '/mystery-home', null);
check('hub while live: this week\'s home links to its page, with no price', r.status === 200 && r.text.includes(`/mystery-home/${slug}`) && !priceLeaks(r.text) && r.text.includes(escapeHtml(lib.MYSTERY_GAME_NOTE)) && r.headers.get('Cache-Control') === 'public, max-age=60' && !!r.headers.get('Content-Security-Policy'));
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { ...body, sellerOkOn: today, brokerOkOn: today, city: 'Bonita' });
check('live: edits -> 409 { code: live }', r.status === 409 && r.json.code === 'live');
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { action: 'unschedule' });
check('live: unschedule -> 409 { code: live }', r.status === 409 && r.json.code === 'live');
r = await upload(1, true);
check('live: adding a photo -> 409', r.status === 409 && r.json.code === 'live');
r = await call(adminPhoto.onRequestDelete, 'DELETE', '/x', 1, { id: H, photoId: String(photoIds[0]) });
check('live: removing a photo -> 409', r.status === 409);

// revealed
sqlite.prepare('UPDATE mystery_homes SET publish_at = ?, reveal_at = ? WHERE id = ?').run(iso(-80), iso(-1), Number(H));
r = await getPage();
const revealedHtml = r.text || '';
check('revealed: "Sold for $987,654" and "<Mon YYYY> · sale price at closing"', r.status === 200 && revealedHtml.includes('Sold for $987,654') && revealedHtml.includes(`${lib.formatSoldMonth(thisMonthMinus(3))} · sale price at closing`), revealedHtml.slice(revealedHtml.indexOf('mystery-reveal'), revealedHtml.indexOf('mystery-reveal') + 300));
check('revealed: the container carries data-mystery-sold', revealedHtml.includes('data-mystery-sold="987654"'));
r = await call(hub.onRequestGet, 'GET', '/mystery-home', null);
check('hub: the revealed home is under "Recent reveals"; the empty state shows with nothing live', r.text.includes('Recent reveals') && r.text.includes(`/mystery-home/${slug}`) && r.text.includes('The next Mystery Home is coming Monday.'));
sqlite.prepare("UPDATE mystery_homes SET source = 'former_owner' WHERE id = ?").run(Number(H));
r = await getPage();
check('revealed, former owner: "sale price as shared by the former owner"', r.text.includes('sale price as shared by the former owner'));
check('no page says "recorded"', !/recorded/i.test(liveHtml + revealedHtml + r.text));
for (const [label, html] of [['live', liveHtml], ['revealed', revealedHtml]]) {
  check(`${label}: no for-sale JSON-LD (RealEstateListing / Offer / InStock)`, !/RealEstateListing|"Offer"|InStock|ld\+json/.test(html));
  check(`${label}: no street address, ZIP or owner name`, !/\b\d{5}\b/.test(html.replace(/0225780\d|#\d+/g, '')) && !html.includes('Secret') && !html.includes('Zelda') && !html.includes('Admin Person'));
  check(`${label}: no "worth", "value", "appraised" or "estimate"`, !/worth|\bvalue|appraised|estimate/i.test(html));
}

// retired
sqlite.prepare('UPDATE mystery_homes SET retire_at = ? WHERE id = ?').run(iso(-0.5), Number(H));
r = await getPage();
check('retired (retire_at passed): page 404', r.status === 404 && !priceLeaks(r.text));
check('retired: out of the sitemap', !(await getSitemap()).includes(slug));
r = await getPhoto();
check('retired: photos 404 for the public', r.status === 404);
r = await call(page.onRequestGet, 'GET', '/mystery-home/nope', null, { slug: 'nope' });
check('unknown slug: 404 with the CSP', r.status === 404 && !!r.headers.get('Content-Security-Policy'));

// retire + delete
sqlite.prepare('UPDATE mystery_homes SET retire_at = ? WHERE id = ?').run(iso(500), Number(H));
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { action: 'retire' });
check('retire works on a live/revealed home and is logged', r.status === 200 && r.json.state === 'retired' && row().status === 'retired' && audits().includes('retire_mystery_home'));
const keysBefore = sqlite.prepare('SELECT r2_key FROM mystery_home_photos WHERE mystery_home_id = ?').all(Number(H)).map(k => k.r2_key);
r = await call(adminOne.onRequestDelete, 'DELETE', '/x', 1, { id: H });
check('DELETE removes the home, its photo rows and every R2 file, and is logged', r.status === 200 && !row() && sqlite.prepare('SELECT COUNT(*) AS n FROM mystery_home_photos').get().n === 0 && keysBefore.length === 3 && keysBefore.every(k => !objects.has(k)) && audits().includes('delete_mystery_home'), `${keysBefore.length} ${objects.size}`);
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: H }, { action: 'retire' });
check('a deleted home is 404 for the admin API', r.status === 404);

// ---------------------------------------------------------------- source checks
const pageSources = readdirSync(`${root}/functions/mystery-home`).map(f => readFileSync(`${root}/functions/mystery-home/${f}`, 'utf8')).join('\n');
check('public pages never read the session', !/getSessionUser|ah_session|Cookie/.test(pageSources));
check('public pages go through withSecurityHeaders', (pageSources.match(/withSecurityHeaders\(/g) || []).length >= 2);
const exportSrc = readFileSync(`${root}/functions/api/account/export.js`, 'utf8');
const deleteSrc = readFileSync(`${root}/functions/api/account/delete.js`, 'utf8');
check('no mystery table in the account export or account delete (admin content)', !/mystery/i.test(exportSrc) && !/mystery/i.test(deleteSrc));
const fk = sqlite.prepare("SELECT * FROM pragma_foreign_key_list('mystery_homes')").all();
check('mystery_homes.created_by is ON DELETE SET NULL (never user data)', fk.some(f => f.from === 'created_by' && f.on_delete === 'SET NULL'));

// ---------------------------------------------------------------- mystery-home.js (client)
const clientSrc = readFileSync(`${root}/mystery-home.js`, 'utf8');
check('mystery-home.js makes no network call (no fetch, apiPost, apiPut, XMLHttpRequest, sendBeacon)', !/fetch\(|apiPost|apiPut|apiGet|XMLHttpRequest|sendBeacon|WebSocket/.test(clientSrc));
check('mystery-home.js copy: "Just for fun"; no crowd/average/ranking wording', clientSrc.includes('Just for fun') && !/top \d+%|average|crowd|agents guessed/i.test(clientSrc));
check('mystery-home.js declares no top-level names (one IIFE)', /^\/\*[\s\S]*?\*\/\s*\(function \(\) \{[\s\S]*\}\)\(\);\s*$/.test(clientSrc));

function runClient({ sold, month, stored }) {
  const draws = [];
  const handlers = {};
  const els = {};
  const el = (id) => (els[id] ||= { id, value: '', textContent: '', addEventListener: (t, fn) => { handlers[id] = fn; } });
  const ctx = {
    font: '16px serif', fillStyle: '', textAlign: '', textBaseline: '',
    createLinearGradient: () => ({ addColorStop() {} }), fillRect() {},
    fillText: (t) => draws.push(String(t)), measureText: (t) => ({ width: String(t).length * (parseInt(String(ctx.font).match(/(\d+)px/)[1], 10) * 0.55) }),
  };
  const store = new Map(stored ? [[`ah_mystery_mh-1`, JSON.stringify(stored)]] : []);
  const pageEl = { dataset: { mysterySlug: 'mh-1', mysteryPlace: 'Chula Vista, CA', ...(sold ? { mysterySold: String(sold), mysteryMonth: month } : {}) } };
  let saved = null;
  const sandbox = {
    document: {
      querySelector: () => pageEl, getElementById: el,
      createElement: (tag) => tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx, toBlob: (cb) => cb(new Blob(['x'], { type: 'image/png' })) } : { click() {}, remove() {} },
      body: { appendChild() {} },
    },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, val) => store.set(k, val) },
    window: {}, navigator: {}, Blob, File, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    setTimeout: () => 0, toast: (m) => { saved = m; }, Math, Number, JSON, Date, Promise, Error, String, Object, Array,
  };
  vm.runInNewContext(clientSrc, sandbox);
  return { draws, handlers, els, el, store, toastMsg: () => saved };
}
let c = runClient({ sold: 987654, month: 'Oct 2026', stored: { guess: 850000, at: 1 } });
check('revealed page with a stored guess: "You guessed $850,000. You came within 13.9%!" on the page only', c.els.mysteryGuessResult.textContent === 'You guessed $850,000. You came within 13.9%!', c.els.mysteryGuessResult && c.els.mysteryGuessResult.textContent);
c.handlers.mysteryShareBtn();
await new Promise(res => setImmediate(res));
const drawn = c.draws.join(' ');
check('share card: "Can you guess it?", the city with the sold month, the game line and the DRE/broker footer', drawn.includes('Can you guess it?') && drawn.includes('Chula Vista, CA · sold Oct 2026') && drawn.includes('Just for fun. Not an appraisal.') && drawn.includes('DRE #02257808') && drawn.includes('Coldwell Banker West') && drawn.includes('AMICO HAUS'), drawn);
check('share card: no %, no $, no number but the DRE # and the sold year (never the guess or the price)', !/[%$]/.test(drawn) && (drawn.replace('02257808', '').replace('2026', '').match(/\d/g) || []).length === 0 && !drawn.includes('850') && !drawn.includes('987'), drawn);
check('share card: the tagline is on it', drawn.replace(/ \| /g, ' ').includes("Everything that's missing from the real estate market for the homeowner!"));
c = runClient({ sold: 987654, month: 'Oct 2026', stored: { guess: 300000, at: 1 } });
check('more than half off: "Nice try! You were off by more than half."', c.els.mysteryGuessResult.textContent === 'You guessed $300,000. Nice try! You were off by more than half.');
c = runClient({});
c.el('mysteryGuess').value = '725000';
c.handlers.mysteryLockBtn();
check('live page: "Lock in my guess" saves { guess, at } to localStorage only', JSON.parse(c.store.get('ah_mystery_mh-1')).guess === 725000 && /Locked in: \$725,000/.test(c.els.mysteryGuessResult.textContent));
c.handlers.mysteryShareBtn();
await new Promise(res => setImmediate(res));
check('live share card: city only (no sold month), still no guess', c.draws.join(' ').includes('Chula Vista, CA') && !c.draws.join(' ').includes('sold') && !c.draws.join(' ').includes('725'));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
