// Video twin pages (owner tools batch): checks the generated functions/_lib/videoTwins.js (claims and fair-housing
// checks on every word, ids, links, covers), the /watch pages (no session read, cache, CSP, DRE strip, JSON-LD
// escaping, no embed), the short links that now land on a video's page, the spoken URLs in _redirects, and the sitemap.
// Runs the real handlers against an in-memory SQLite stand-in for D1. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/video-twins-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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
};
const env = { DB };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + String(detail).slice(0, 400)}`); };

// Copied verbatim from the twin generator kept outside this repo.
const TWIN_BANNED_RE = /win rate|\bratings?\b|\brated\b|review each other|\breviews?\b|most hired|track record|six percent|\b\d+(\.\d+)?\s?%|percent|\$\s?\d|mckelvey|patti|jeff|verified|vetted|guarantee|\bbest (agent|price|deal|offer)|top (agent|rated|dollar|producer)|\brank(ed|ing|ings|s)?\b|number one|#1\b|appraisal|worth|\bvalue\b|commission|\bfees?\b|sell (it |your home )?(for )?more|more money|higher (sale )?price|sell faster|save (you )?(thousands|money)|\binvest(or|ors|ment|ments|ing)?\b|calculator|take-home|\blease\b|price tier|neighbou?rhood (of tomorrow|hub|groups?)|community (feed|groups?|hub)|amicko/i;
// The generator's extra check: a removed feature (the "biggest price drop" leaderboard) and owner-entered values.
const TWIN_EXTRA_RE = /leaderboard|biggest price drop|hottest listing|\bvalues\b/i;
const POST_HOST_RE = /^https:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com)\//;

const twinsMod = await mod('functions/_lib/videoTwins.js');
const { VIDEO_TWINS, TWIN_BY_ID, TWIN_BY_SLUG, TWIN_CTAS, TWIN_SERIES } = twinsMod;
const { VIDEO_ID_RE, shortLinkTarget } = await mod('functions/_lib/shortLinks.js');
const { steeringProblem } = await mod('functions/_lib/homeText.js');

// ---------------------------------------------------------------- the regex itself
for (const ok of ['operating', 'broker preview', 'previewing the home']) {
  check(`TWIN_BANNED_RE lets "${ok}" through`, !TWIN_BANNED_RE.test(ok));
}
for (const bad of ['6%', 'win rate', 'sell for more', 'investors', 'home value', 'Six percent selling costs', 'review each other', 'most hired', 'Amicko House', '$940,000', 'commission', 'The Neighborhood of Tomorrow']) {
  check(`TWIN_BANNED_RE catches "${bad}"`, TWIN_BANNED_RE.test(bad));
}

// ---------------------------------------------------------------- the data
check('there is at least one video page', VIDEO_TWINS.length > 0, VIDEO_TWINS.length);
const ids = new Set(), slugs = new Set();
const KEYS = ['id', 'slug', 'series', 'n', 'title', 'hook', 'description', 'transcript', 'cta', 'cover', 'posts', 'uploadDate', 'spoken'];
for (const t of VIDEO_TWINS) {
  const tag = t.id || '(no id)';
  check(`${tag}: has every key`, KEYS.every(k => k in t), KEYS.filter(k => !(k in t)).join());
  check(`${tag}: id matches VIDEO_ID_RE, slug is lowercase-hyphen`, VIDEO_ID_RE.test(t.id) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug));
  check(`${tag}: unique id and slug`, !ids.has(t.id) && !slugs.has(t.slug));
  ids.add(t.id); slugs.add(t.slug);
  check(`${tag}: series is tomorrow/toons/talks, n is a positive integer`, ['tomorrow', 'toons', 'talks'].includes(t.series) && TWIN_SERIES[t.series] && Number.isInteger(t.n) && t.n > 0);
  check(`${tag}: cta is one of TWIN_CTAS with its label`, TWIN_CTAS[t.cta && t.cta.href] === (t.cta && t.cta.label));
  const posts = Object.entries(t.posts || {});
  check(`${tag}: at least one post link, all on YouTube/TikTok/Instagram/Facebook over https`, posts.length > 0 && posts.every(([k, u]) => ['youtube', 'tiktok', 'instagram', 'facebook'].includes(k) && POST_HOST_RE.test(u)), JSON.stringify(t.posts));
  check(`${tag}: uploadDate is a date`, /^\d{4}-\d{2}-\d{2}$/.test(t.uploadDate || ''));
  check(`${tag}: transcript is a list of lines`, Array.isArray(t.transcript) && t.transcript.length > 0 && t.transcript.every(l => typeof l === 'string' && l.trim()));
  const text = [t.title, t.hook, t.description, ...t.transcript].join('\n');
  check(`${tag}: no removed/risky claim words (TWIN_BANNED_RE + extra)`, !TWIN_BANNED_RE.test(text) && !TWIN_EXTRA_RE.test(text), (text.match(TWIN_BANNED_RE) || text.match(TWIN_EXTRA_RE) || [''])[0]);
  check(`${tag}: no steering words (fair housing)`, steeringProblem(text) === null, steeringProblem(text));
  check(`${tag}: written "Amico Haus", never "Amicko"`, !/amicko/i.test(text));
  if (t.cover) {
    const file = `${root}${t.cover}`;
    check(`${tag}: cover is /img/watch/<slug>.jpg, on disk, under 400 KB`, t.cover === `/img/watch/${t.slug}.jpg` && existsSync(file) && statSync(file).size <= 400 * 1024, t.cover);
  }
  check(`${tag}: spoken is null or the id-style segment`, t.spoken === null || /^[a-z0-9-]+$/.test(t.spoken));
  check(`${tag}: lookups find it`, TWIN_BY_ID.get(t.id) === t && TWIN_BY_SLUG.get(t.slug) === t);
}
const twinFile = readFileSync(`${root}/functions/_lib/videoTwins.js`, 'utf8');
check('videoTwins.js says it is generated', twinFile.startsWith('// Generated by the twin generator kept outside this repo. Edit the allow-list, not this file.'));
check('videoTwins.js never mentions McKelvey, Patti or Jeff', !/mckelvey|patti|jeff/i.test(twinFile));
check('only Amico series (no MV/IZ/listing reels)', VIDEO_TWINS.every(t => /^(tomorrow\d+|toon\d+|ah\d+)$/.test(t.id)));
for (const pinned of ['mv4', 'iz2', 'amico-tomorrow-ep-12', 'a'.repeat(40)]) {
  check(`launch-test's pinned id "${pinned.length > 20 ? 'a x40' : pinned}" is not a video page`, !TWIN_BY_ID.has(pinned));
}
const used = new Set(VIDEO_TWINS.filter(t => t.cover).map(t => t.cover.replace('/img/watch/', '')));
const onDisk = existsSync(`${root}/img/watch`) ? readdirSync(`${root}/img/watch`) : [];
check('img/watch holds only covers that a page uses', onDisk.every(f => used.has(f)) && [...used].every(f => onDisk.includes(f)), onDisk.join());

// ---------------------------------------------------------------- short links
const twin = VIDEO_TWINS[0];
check('shortLinkTarget: a video with a page goes to /watch/<slug> with the tags', shortLinkTarget('youtube', [twin.id]) === `/watch/${twin.slug}?utm_source=youtube&utm_medium=video&utm_campaign=${twin.id}`, shortLinkTarget('youtube', [twin.id]));
check('shortLinkTarget: uppercase and a trailing slash still reach the page', shortLinkTarget('tiktok', [twin.id.toUpperCase(), '']) === `/watch/${twin.slug}?utm_source=tiktok&utm_medium=video&utm_campaign=${twin.id}`);
check('shortLinkTarget: <id>/agents still goes to /for-agents', shortLinkTarget('instagram', [twin.id, 'agents']) === `/for-agents?utm_source=instagram&utm_medium=video&utm_campaign=${twin.id}`);
check('shortLinkTarget: a video without a page is unchanged (mv4 -> /)', shortLinkTarget('youtube', ['mv4']) === '/?utm_source=youtube&utm_medium=video&utm_campaign=mv4');
check('shortLinkTarget: a bad id still falls back to /', shortLinkTarget('youtube', ['-x']) === '/' && shortLinkTarget('youtube', [twin.id, 'other']) === '/');
const shortSrc = readFileSync(`${root}/functions/_lib/shortLinks.js`, 'utf8');
check('shortLinks.js stays database-free', !/env\.DB|\.prepare\(/.test(shortSrc));

// ---------------------------------------------------------------- _redirects (spoken URLs)
const redirects = readFileSync(`${root}/_redirects`, 'utf8').replace(/\r\n/g, '\n');
const START = '# ---- video twins (generated) ----', END = '# ---- end video twins ----';
const block = redirects.slice(redirects.indexOf(START) + START.length, redirects.indexOf(END)).split('\n').map(l => l.trim()).filter(Boolean);
const want = VIDEO_TWINS.filter(t => t.spoken).map(t => `/${t.spoken} /watch/${t.slug} 301`);
check('_redirects has exactly one generated block', redirects.split(START).length === 2 && redirects.split(END).length === 2);
check('the generated block matches the spoken entries exactly', JSON.stringify(block) === JSON.stringify(want), `${block.length} vs ${want.length}`);
const taken = new Set([
  ...readdirSync(root).map(n => n.toLowerCase().replace(/\.[^.]+$/, '')),
  ...readdirSync(`${root}/functions`).map(n => n.toLowerCase().replace(/\.[^.]+$/, '')),
  't', 'i', 'y', 'f', 'watch', 'mystery-home', 'app', 'api', 'img',
]);
const collide = VIDEO_TWINS.filter(t => t.spoken && taken.has(t.spoken)).map(t => t.spoken);
check('no spoken URL collides with a root page or file, a functions/ directory or a reserved path', collide.length === 0, collide.join());

// ---------------------------------------------------------------- pages
const hub = await mod('functions/watch/index.js');
const one = await mod('functions/watch/[slug].js');
const get = async (handler, path, params = {}) => {
  const res = await handler({ request: new Request(`https://amicohaus.com${path}`, { headers: { Cookie: 'ah_session=nobody' } }), env, params });
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const watchSrc = readdirSync(`${root}/functions/watch`).map(f => readFileSync(`${root}/functions/watch/${f}`, 'utf8')).join('\n');
check('watch pages never read the session', !/getSessionUser|ah_session|Cookie/.test(watchSrc));
let r = await get(hub.onRequestGet, '/watch');
check('/watch: 200, public max-age=300, CSP from withSecurityHeaders', r.status === 200 && r.headers.get('Cache-Control') === 'public, max-age=300' && !!r.headers.get('Content-Security-Policy'));
check('/watch: h1 "Amico Haus videos" and every page is listed with its hook', r.text.includes('<h1>Amico Haus videos</h1>') && VIDEO_TWINS.every(t => r.text.includes(`href="/watch/${t.slug}"`)), VIDEO_TWINS.filter(t => !r.text.includes(`/watch/${t.slug}"`)).map(t => t.slug).join());
check('/watch: one .watch-hub list per series that has pages', (r.text.match(/class="watch-hub"/g) || []).length === new Set(VIDEO_TWINS.map(t => t.series)).size);
const { escapeHtml } = await mod('functions/_lib/util.js');
for (const t of VIDEO_TWINS) {
  r = await get(one.onRequestGet, `/watch/${t.slug}`, { slug: t.slug });
  const h = r.text;
  const ok = r.status === 200 && r.headers.get('Cache-Control') === 'public, max-age=300' && !!r.headers.get('Content-Security-Policy') &&
    h.includes(`<h1>${escapeHtml(t.hook)}</h1>`) && h.includes('<h2>Transcript</h2>') && t.transcript.every(l => h.includes(`<p>${escapeHtml(l)}</p>`)) &&
    (h.match(/class="watch-cta"/g) || []).length === 1 && h.includes(`href="${escapeHtml(t.cta.href)}"`) &&
    h.includes('class="agent-strip"') && h.includes('DRE #02257808') && h.includes('<span class="footer-tagline">') &&
    !/<iframe/i.test(h) && h.includes(`${escapeHtml(TWIN_SERIES[t.series])} · Episode ${t.n}`);
  check(`/watch/${t.slug}: hook h1, transcript, one CTA, DRE strip, tagline, cache, CSP, no iframe`, ok, `${r.status}`);
  const links = Object.values(t.posts).every(u => h.includes(`href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer"`));
  check(`/watch/${t.slug}: only the real post links, opened safely`, links && h.includes('Watch it on:'));
  const scripts = [...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const inline = scripts.filter(s => !/\bsrc=/.test(s[1]));
  const ld = inline.filter(s => /application\/ld\+json/.test(s[1]));
  check(`/watch/${t.slug}: the only inline script is JSON-LD, with no raw "<" inside, and no third-party script`, inline.length === ld.length && ld.every(s => !s[2].includes('<')) && scripts.every(s => !/src="https?:/.test(s[1])));
  if (t.posts.youtube && t.cover) {
    let data = null;
    try { data = JSON.parse(ld[0][2]); } catch { /* checked below */ }
    check(`/watch/${t.slug}: VideoObject JSON-LD (name, description, thumbnail, uploadDate, YouTube embedUrl)`, data && data['@type'] === 'VideoObject' && data.name && data.description && data.thumbnailUrl === `https://amicohaus.com${t.cover}` && data.uploadDate === t.uploadDate && /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]+$/.test(data.embedUrl), ld[0] && ld[0][2]);
  } else {
    check(`/watch/${t.slug}: no JSON-LD without a YouTube post and a cover`, ld.length === 0);
  }
  if (t.cover) check(`/watch/${t.slug}: the cover image with "<title> video cover" alt text`, h.includes(`class="watch-cover" src="${t.cover}" alt="${escapeHtml(t.title)} video cover"`));
}
r = await get(one.onRequestGet, '/watch/not-a-video', { slug: 'not-a-video' });
check('unknown slug: 404, noindex, public max-age=60, CSP', r.status === 404 && r.text.includes('noindex') && r.headers.get('Cache-Control') === 'public, max-age=60' && !!r.headers.get('Content-Security-Policy'));
const series0 = VIDEO_TWINS.filter(t => t.series === VIDEO_TWINS[0].series);
if (series0.length > 1) {
  r = await get(one.onRequestGet, `/watch/${series0[0].slug}`, { slug: series0[0].slug });
  const r2 = await get(one.onRequestGet, `/watch/${series0[1].slug}`, { slug: series0[1].slug });
  check('prev/next stay inside the series', r.text.includes(`href="/watch/${series0[1].slug}">Next episode →`) && !r.text.includes('Previous episode') && r2.text.includes(`href="/watch/${series0[0].slug}">← Previous episode`));
}

// ---------------------------------------------------------------- sitemap
const sitemap = await mod('functions/sitemap.xml.js');
const sm = await (await sitemap.onRequestGet({ env, request: new Request('https://amicohaus.com/sitemap.xml') })).text();
check('sitemap lists /watch and /mystery-home', sm.includes('<loc>https://amicohaus.com/watch</loc>') && sm.includes('<loc>https://amicohaus.com/mystery-home</loc>'));
check('sitemap lists every video page', VIDEO_TWINS.every(t => sm.includes(`<loc>https://amicohaus.com/watch/${t.slug}</loc>`)));

// ---------------------------------------------------------------- build
const build = readFileSync(`${root}/build-dist.js`, 'utf8');
check("build-dist.js versions /mystery-home.js for the server-rendered pages", /SERVER_RENDERED_ASSETS = \[[^\]]*'\/mystery-home\.js'/.test(build));
check('build-dist.js does not skip img/ (covers are published)', !/'img'/.test(build.match(/SKIP_NAMES = new Set\(\[[\s\S]*?\]\)/)[0]));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
