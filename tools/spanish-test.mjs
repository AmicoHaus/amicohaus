// Spanish pages (es/*.html), the display language (users.ui_lang) and the legal/copy changes of the home facts batch.
// Static checks on the pages plus the real signup / resend / me / sitemap handlers on an in-memory SQLite stand-in
// for D1 (no network). Page scripts and client.js run in a vm with a stubbed browser.
// Usage: node --disable-warning=ExperimentalWarning tools/spanish-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = process.argv[2];
if (!root) { console.error('usage: spanish-test.mjs <projectRoot>'); process.exit(2); }
const read = (p) => readFileSync(`${root}/${p}`, 'utf8');
const mod = (p) => import(pathToFileURL(`${root}/${p}`).href);

let failed = 0, passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + String(detail).slice(0, 400)}`); };

// ---------------------------------------------------------------- the 9 pages and their twins
// [spanish file, spanish path, english file, english path, indexable]
const PAGES = [
  ['es/index.html', '/es/', 'index.html', '/', true],
  ['es/acerca.html', '/es/acerca', 'about.html', '/about', true],
  ['es/agentes.html', '/es/agentes', 'for-agents.html', '/for-agents', true],
  ['es/contacto.html', '/es/contacto', 'contact.html', '/contact', true],
  ['es/registro.html', '/es/registro', 'signup.html', '/signup', false],
  ['es/iniciar-sesion.html', '/es/iniciar-sesion', 'login.html', '/login', false],
  ['es/accesibilidad.html', '/es/accesibilidad', 'accessibility.html', '/accessibility', true],
  ['es/terminos.html', '/es/terminos', 'terms.html', '/terms', true],
  ['es/privacidad.html', '/es/privacidad', 'privacy.html', '/privacy', true],
];
const SITE = 'https://amicohaus.com';
const esFiles = existsSync(`${root}/es`) ? readdirSync(`${root}/es`).filter(f => f.endsWith('.html')).sort() : [];
check('es/ holds exactly the 9 Spanish pages', JSON.stringify(esFiles) === JSON.stringify(PAGES.map(p => p[0].slice(3)).sort()), esFiles.join(', '));

const css = read('styles.css');
const AGENT_STRIP = '<a class="agent-strip" href="/es/acerca">Presentado por <strong>Rudy Flores</strong> &middot; Coldwell Banker West &middot; DRE #02257808</a>';
const FOOTER_LEGAL_ES = '<p class="footer-legal">Equal Housing Opportunity · Igualdad de Oportunidad en la Vivienda · <a href="/es/accesibilidad">Accesibilidad</a></p>';
const TAGLINE = "Amico Haus: the real estate marketplace of tomorrow! Everything that's missing from the real estate market for the homeowner!";
const ES_TAGLINE = "Amico Haus: ¡el mercado inmobiliario del mañana! ¡Todo lo que le falta al mercado inmobiliario para el propietario!";
const NAV_ES = [
  ['tab tab-demo', '/demo', 'Demo (en inglés)'],
  ['tab tab-cta tab-cta-post', '/es/registro?as=homeowner', 'Publicar un pre-listado'],
  ['tab tab-cta tab-cta-agent', '/es/registro?as=agent', 'Soy agente'],
  ['tab', '/es/#como', 'Cómo funciona'],
  ['tab', '/es/acerca', 'Acerca de'],
];
const FAIR_RE = /habla(n)? español|hispan|latin[oa]|agentes que hablan|comunidad hispana/i;
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const navOf = (html) => (html.match(/<nav class="tabs"[^>]*>([\s\S]*?)<\/nav>/) || [])[1] || '';
const hrefsOf = (html) => [...html.matchAll(/\bhref="([^"]*)"/g)].map(m => m[1]);
const altLinks = (html) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => [m[1], m[2]]);
const canonicalOf = (html) => (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1] || null;

for (const [esFile, esPath, enFile, enPath, indexable] of PAGES) {
  const es = existsSync(`${root}/${esFile}`) ? read(esFile) : '';
  const en = read(enFile);
  check(`${esFile}: exists, <html lang="es" data-theme="light">`, es.includes('<html lang="es" data-theme="light">'));
  check(`${esFile}: its own <title> and the comment naming its twin`, /<title>[^<]*Amico Haus[^<]*<\/title>/.test(es) && es.includes(`<!-- Spanish twin of ${enFile}`));
  if (indexable) {
    check(`${esFile}: canonical is itself, with a description`, canonicalOf(es) === SITE + esPath && /<meta name="description" content="[^"]+">/.test(es), canonicalOf(es));
    const want = JSON.stringify([['en', SITE + enPath], ['es', SITE + esPath], ['x-default', SITE + enPath]]);
    check(`${esFile}: hreflang en / es / x-default (x-default = English)`, JSON.stringify(altLinks(es)) === want, JSON.stringify(altLinks(es)));
    check(`${enFile}: the same three hreflang links back (reciprocal)`, JSON.stringify(altLinks(en)) === want, JSON.stringify(altLinks(en)));
    check(`${esFile}: not noindex`, !/noindex/.test(es));
  } else {
    check(`${esFile}: noindex, nofollow like ${enFile}, no canonical, no hreflang`, es.includes('<meta name="robots" content="noindex, nofollow">') && en.includes('<meta name="robots" content="noindex, nofollow">') && !canonicalOf(es) && altLinks(es).length === 0);
    check(`${enFile}: no canonical and no hreflang either`, !canonicalOf(en) && altLinks(en).length === 0);
  }
  // Links: every local src/href starts with "/" (a relative client.js inside /es/ would load /es/client.js), and every
  // local script, stylesheet and icon exists.
  const local = [...es.matchAll(/\b(?:src|href)="([^"]*)"/g)].map(m => m[1]).filter(h => !/^(https?:|mailto:|tel:|sms:)/.test(h));
  const relative = local.filter(h => !h.startsWith('/') || h.startsWith('//'));
  check(`${esFile}: every local src/href starts with "/"`, relative.length === 0, relative.join(', '));
  const assets = local.map(h => h.split(/[?#]/)[0]).filter(h => /\.(js|css|svg|png|json|ico)$/.test(h));
  const missing = assets.filter(h => !existsSync(`${root}${h}`));
  check(`${esFile}: every local script, stylesheet and icon exists`, missing.length === 0, missing.join(', '));
  // CSP: no inline style/handlers; a <script> tag is either src= or JSON-LD; the beacon tag exactly as on the twin.
  const tags = es.match(/<script\b[^>]*>/gi) || [];
  check(`${esFile}: no style=, no on*=, no inline <script> except JSON-LD`, !/\sstyle\s*=/i.test(es) && !/\son[a-z]+\s*=/i.test(es) && tags.every(t => /\ssrc=/i.test(t) || /type="application\/ld\+json"/i.test(t)));
  const beacon = (h) => (h.match(/<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js"[^>]*><\/script>/) || [])[0];
  check(`${esFile}: the Cloudflare beacon tag exactly as on ${enFile}, no other script host`, !!beacon(es) && beacon(es) === beacon(en)
    && tags.filter(t => /\ssrc="https?:/i.test(t)).every(t => t.includes('https://static.cloudflareinsights.com/')));
  const ld = [...es.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  check(`${esFile}: JSON-LD parses and has no raw "<"`, ld.every(j => { try { JSON.parse(j); return !j.includes('<'); } catch { return false; } }));
  // Classes come from styles.css.
  const classes = new Set([...es.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
  const noCss = [...classes].filter(c => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  check(`${esFile}: uses only classes styles.css has`, noCss.length === 0, noCss.join(', '));
  // Top menu (exact), the English tab last, the auth buttons.
  const navLinks = [...navOf(es).matchAll(/<a class="([^"]+)" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m => [m[1].replace(/ active$/, ''), m[2], m[3]]);
  check(`${esFile}: top menu exactly as the spec`, JSON.stringify(navLinks.slice(0, 5)) === JSON.stringify(NAV_ES), JSON.stringify(navLinks));
  check(`${esFile}: last tab is English, linking ${enPath}`, navOf(es).trim().endsWith(`<a class="tab tab-lang" href="${enPath}" hreflang="en" lang="en">English</a>`) && navLinks.length === 6);
  check(`${enFile}: its Español tab links ${esPath} (no-script, static)`, navOf(en).trim().endsWith(`<a class="tab tab-lang" href="${esPath}" hreflang="es" lang="es">Español</a>`));
  check(`${esFile}: Iniciar sesión / Registrarse buttons`, es.includes('<a class="btn btn-ghost btn-sm" href="/es/iniciar-sesion">Iniciar sesión</a>') && es.includes('<a class="btn btn-primary btn-sm" href="/es/registro">Registrarse</a>'));
  // Compliance lines.
  check(`${esFile}: agent strip exactly (license data identical to English)`, es.includes(AGENT_STRIP));
  check(`${esFile}: footer legal line exactly`, es.includes(FOOTER_LEGAL_ES));
  check(`${esFile}: footer links (Acerca de, Contacto, Términos de uso (resumen), Privacidad (resumen), Accesibilidad)`,
    ['<a href="/es/acerca">Acerca de</a>', '<a href="/es/contacto">Contacto</a>', '<a href="/es/terminos">Términos de uso (resumen)</a>', '<a href="/es/privacidad">Privacidad (resumen)</a>', '<a href="/es/accesibilidad">Accesibilidad</a>'].every(s => es.includes(s)));
  check(`${esFile}: DRE #02257808 and Coldwell Banker West`, es.includes('DRE #02257808') && es.includes('Coldwell Banker West'));
  check(`${esFile}: the Spanish tagline Rudy approved 11.11 (no English one)`, es.includes(ES_TAGLINE) && !es.includes(TAGLINE));
  check(`${enFile}: the English Equal Housing Opportunity line is still there`, /<p class="footer-legal">[^\n]*Equal Housing Opportunity · <a href="\/accessibility">Accessibility<\/a><\/p>/.test(en));
  check(`${esFile}: no McKelvey, Patti or Jeff`, !/mckelvey|\bpatti\b|\bjeff\b/i.test(es));
  // Fair housing: nothing about who speaks Spanish; no language filter in any link.
  check(`${esFile}: no language/national-origin targeting`, !FAIR_RE.test(textOf(es)), (textOf(es).match(FAIR_RE) || [])[0]);
  check(`${esFile}: no href carries language=`, !hrefsOf(es).some(h => /language=/i.test(h)));
  check(`${esFile}: no Spanish lender/RESPA text in v1`, !/NMLS|Point Mortgage|préstamo|hipoteca/i.test(textOf(es)));
  // Same calls to action as the twin, at their Spanish counterparts.
  const MAP = { '/': '/es/', '/signup?as=homeowner': '/es/registro?as=homeowner', '/signup?as=agent': '/es/registro?as=agent', '/signup': '/es/registro', '/login': '/es/iniciar-sesion',
    '/about': '/es/acerca', '/contact': '/es/contacto', '/for-agents': '/es/agentes', '/accessibility': '/es/accesibilidad', '/#how': '/es/#como', '#directory': '/#directory',
    '/terms': ['/terms', '/es/terminos'], '/privacy': ['/privacy', '/es/privacidad'] };
  // Left out on purpose: the English footer's What's New / Calculator / Assumable loans links (English-only pages, v1),
  // the live directory's own form, and the English tab itself.
  const SKIP = new Set(['/whats-new', '/calculator', '/assumable-loans', esPath, 'styles.css', 'favicon.svg', 'manifest.json', 'icon-192.png',
    // The Gmail button searches for the email's own subject (Spanish on es/registro, checked below).
    'https://mail.google.com/mail/u/0/#search/%22Confirm+your+email+to+finish+signing+up%22']);
  // The Terms and Privacy twins are short summaries (the English text controls), so only their menu and footer count.
  const summary = /terminos|privacidad/.test(esFile);
  const esHrefs = new Set(hrefsOf(es));
  const lost = [...new Set(hrefsOf(summary ? en.replace(/<main[\s\S]*<\/main>/, '') : en))].filter(h => !SKIP.has(h) && !h.endsWith('.css') && !h.endsWith('.svg') && !h.endsWith('.json') && !h.endsWith('.png'))
    .filter(h => { const want = MAP[h] ?? h; return !(Array.isArray(want) ? want.some(w => esHrefs.has(w)) : esHrefs.has(want)); });
  check(`${esFile}: every link and call to action of ${enFile} has its Spanish counterpart`, lost.length === 0, lost.join(', '));
}

// ---------------------------------------------------------------- page specifics
const esIndex = read('es/index.html');
check('es/index: the fixed hero strings', esIndex.includes('<p class="eyebrow">Agent Strategy &middot; un pre-listado</p>') && esIndex.includes('<h1>Agentes locales expertos opinan sobre el precio de su casa, antes de que la ponga en venta.</h1>')
  && ['>Publicar un pre-listado</a>', '>Soy agente</a>', '<a class="btn btn-ghost" href="/demo">Ver una demostración (en inglés)</a>'].every(s => esIndex.includes(s)));
check('es/index: first use of pre-listado is explained', esIndex.includes('pre-listado (antes de publicar su casa en el MLS)'));
check('es/index: trust line kept', esIndex.includes('La opinión de precio es una opinión, no un avalúo &middot; No se procesan pagos en Amico Haus &middot; Presentado por Rudy Flores, Coldwell Banker West'));
check('es/index: links to the live English agents and directory, no live script', esIndex.includes('<a class="btn btn-ghost btn-sm" href="/#meet-agents">Ver los agentes (en inglés)</a>') && esIndex.includes('href="/#directory">Ver los anuncios (en inglés)</a>') && !/page-home\.js|agent-cards\.js/.test(esIndex));
check('es/index: "Gratis para propietarios" + the area line', esIndex.includes('Gratis para propietarios · Ahora en el condado de San Diego: Chula Vista, EastLake, Bonita'));
check('es/index: JSON-LD says inLanguage es', /"inLanguage": "es"/.test(esIndex));
check('es/index: the "un idioma" preference is translated as is', esIndex.includes('un idioma'));
const reg = read('es/registro.html');
const CONSENT = '<p class="form-note" id="termsConsent">Al tocar Enviarme un enlace, usted acepta los <a href="/terms">Términos de uso</a> y la <a href="/privacy">Política de privacidad</a>, que están en inglés; la versión en inglés es la que rige. Resúmenes en español: <a href="/es/terminos">Términos</a> · <a href="/es/privacidad">Privacidad</a>.</p>';
check('es/registro: the exact consent line (links /terms, /privacy, /es/terminos, /es/privacidad)', reg.includes(CONSENT));
check('es/registro: submit "Enviarme un enlace" described by the consent line', reg.includes('<button type="submit" class="btn btn-primary" id="submitBtn" aria-describedby="termsConsent">Enviarme un enlace</button>'));
const SIGNUP_IDS = ['signupPanel', 'signupForm', 'displayName', 'email', 'termsConsent', 'submitBtn', 'signupError', 'haveCodeBtn', 'checkEmailPanel', 'sentTo', 'inAppHint', 'inAppName', 'codeForm', 'codeEmailField', 'codeEmail', 'confirmCode', 'codeBtn', 'codeError', 'mailButtons', 'resendBtn', 'resendStatus', 'differentEmailLink'];
check('es/registro: same form ids as signup.html, /page-signup.js', SIGNUP_IDS.every(id => reg.includes(`id="${id}"`) && read('signup.html').includes(`id="${id}"`)) && reg.includes('<script src="/page-signup.js"></script>'));
check('es/registro: the subject it tells people to look for is the Spanish one', reg.includes('"Confirme su correo para terminar de registrarse"') && reg.includes('#search/%22Confirme+su+correo+para+terminar+de+registrarse%22'));
const login = read('es/iniciar-sesion.html');
check('es/iniciar-sesion: same form ids as login.html, /page-login.js', ['loginForm', 'email', 'password', 'submitBtn', 'twoFactorForm', 'twoFactorCode', 'twoFactorSubmitBtn', 'unconfirmedRow', 'resendLinkBtn'].every(id => login.includes(`id="${id}"`) && read('login.html').includes(`id="${id}"`)) && login.includes('<script src="/page-login.js"></script>'));
const contact = read('es/contacto.html');
check('es/contacto: same form ids as contact.html, /page-contact.js (posts to the same /api/contact)', ['contactForm', 'name', 'email', 'phone', 'phoneConsent', 'message', 'submitBtn', 'contactError', 'resultNote', 'authCta'].every(id => contact.includes(`id="${id}"`) && read('contact.html').includes(`id="${id}"`)) && contact.includes('<script src="/page-contact.js"></script>'));
check('es/agentes: claims-light lines kept', ['Ser fundador es solo un reconocimiento: a ningún agente se le prometen contactos, clientes ni negocios.', 'Cada agente fija sus propias comisiones; las comisiones son negociables y no las fija la ley ni Amico Haus.', 'No se procesan pagos en Amico Haus.', 'Amico Haus es administrado por Rudy Flores, un agente de Coldwell Banker West que puede competir por las mismas casas.', 'Presentado por Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West · Equal Housing Opportunity'].every(s => read('es/agentes.html').includes(s)));
const JURY_ES = /\b(verificad[oa]s?|garantizad[oa]s?|los mejores agentes|el mejor agente|número uno|#1|certificad[oa]s?)\b/i;
check('Spanish pages: no vouching/ranking words', PAGES.every(p => !JURY_ES.test(textOf(read(p[0])))), PAGES.map(p => (textOf(read(p[0])).match(JURY_ES) || [''])[0]).join('|'));

// ---------------------------------------------------------------- legal summaries + English legal pages
const termsEs = read('es/terminos.html'), privEs = read('es/privacidad.html'), terms = read('terms.html'), privacy = read('privacy.html');
check('es/terminos: h1 + the exact controlling banner, linking /terms', termsEs.includes('<h1>Términos de uso: resumen en español</h1>') && termsEs.includes('<div class="card legal-summary-banner">')
  && termsEs.includes('Este resumen es solo informativo. Los <a href="/terms">Términos de uso en inglés</a> son la versión que rige; si hay alguna diferencia, prevalece la versión en inglés.'));
check('es/privacidad: h1 + the exact controlling banner, linking /privacy, and "No vendemos sus datos."', privEs.includes('<h1>Política de privacidad: resumen en español</h1>') && privEs.includes('<div class="card legal-summary-banner">')
  && privEs.includes('Este resumen es solo informativo. La <a href="/privacy">Política de privacidad en inglés</a> es la versión que rige; si hay alguna diferencia, prevalece la versión en inglés.') && privEs.includes('<p>No vendemos sus datos.</p>'));
const olItems = (html) => ((html.match(/<ol>([\s\S]*?)<\/ol>/) || [])[1] || '').match(/<li>[^<]+<\/li>/g) || [];
const h2Count = (html) => (html.match(/<h2[^>]*>\d+\./g) || []).length;
check('es/terminos: one summary item per numbered section of terms.html (21, ending in Traducciones)', olItems(termsEs).length === 21 && h2Count(terms) === 21 && olItems(termsEs)[20] === '<li>Traducciones</li>', `${olItems(termsEs).length} / ${h2Count(terms)}`);
check('es/privacidad: one summary item per numbered section of privacy.html (10)', olItems(privEs).length === 10 && h2Count(privacy) === 10, `${olItems(privEs).length} / ${h2Count(privacy)}`);
check('both summaries: the contact line', [termsEs, privEs].every(h => h.includes('<p>¿Preguntas? Escríbanos por el <a href="/es/contacto">formulario de contacto</a>.</p>')));
check('terms.html: §21 Translations, exactly, after §20', terms.includes('<h2>21. Translations</h2><p>We may offer pages or summaries in other languages, such as Spanish, for convenience. These English Terms are the binding version; if a translation differs, the English version controls.</p>') && terms.indexOf('<h2>21. Translations</h2>') > terms.indexOf('<h2>20. Contact</h2>'));
const PRIV_NEW = [
  ['§1', 1, '<li>Your display language (English or Spanish), if you pick one. Only you see it; we use it only to show the Spanish pages and sign-up emails in that language, never to choose which homes or agents you see.</li>'],
  ['§1', 1, '<li>Home facts you add to a listing (yard and sun, parking and garage, pets, floor plan). They show on the listing as your own words; your floor plan is listed with other homes only if you turn that on.</li>'],
  ['§3', 3, '<p>Your exact street address is never shown to other users — only your city and, if you choose to share it, your neighborhood — unless you share your contact info with an agent on a pre-listing, open a broker preview, or turn on address sharing for one of your open houses (all below). "Why you\'re moving" tags are left off public listing pages and flyers.</p>'],
  ['§3', 3, '<p>Open houses: if you turn on "Share the street address with people who RSVP" for an open house, people who RSVP\'d see that address from 24 hours before it starts until it ends, and you see the display names of the people going. When you RSVP to someone else\'s open house, its owner sees your display name (RSVPs made before November 11, 2026 show only in the count). Blocking either way hides the address and your name from each other.</p>'],
  ['§5', 5, "<p>When you tap Plan your drive, Directions or Open the whole route, the area or address you picked opens in Google Maps or Apple Maps under their privacy policies. We don't send it to them ourselves.</p>"],
  ['§8', 8, '<p>Places you type into "Plan your drive" and the order of your open-house plan stay in your browser\'s storage; we don\'t receive them.</p>'],
];
const sec = (n) => privacy.slice(privacy.indexOf(`<h2>${n}.`), privacy.indexOf(`<h2>${n + 1}.`) > 0 ? privacy.indexOf(`<h2>${n + 1}.`) : undefined);
PRIV_NEW.forEach(([s, n, line], i) => check(`privacy.html ${s}: addition ${i + 1} exactly once, in its section`, privacy.split(line).length === 2 && sec(n).includes(line)));
check('privacy.html: the old "...on a pre-listing (below)." promise is gone', !privacy.includes('unless you share your contact info with an agent on a pre-listing (below).'));

// ---------------------------------------------------------------- dates agree (one bump)
const T = await mod('functions/_lib/terms.js');
check('terms.js: one bump, 2026-11-11 / November 11, 2026', T.CURRENT_TERMS_VERSION === '2026-11-11' && T.TERMS_UPDATED_LABEL === 'November 11, 2026');
check('terms.html and privacy.html carry the same version and date', terms.includes(`Last updated ${T.TERMS_UPDATED_LABEL} (version ${T.CURRENT_TERMS_VERSION}).`) && privacy.includes(`<p class="section-sub">Last updated ${T.TERMS_UPDATED_LABEL}.</p>`));
check('privacy.html: the RSVP-names date is the same day', privacy.includes(`RSVPs made before ${T.TERMS_UPDATED_LABEL} show only in the count`));
if (existsSync(`${root}/functions/_lib/openHousePlan.js`)) {
  const ohp = await mod('functions/_lib/openHousePlan.js');
  // Names come from each RSVP's rsvp_named flag, not a date (an RSVP made on the old code before the deploy is never named).
  check('openHousePlan.js: no GOING_NAMES_FROM date; names follow the rsvp_named flag', ohp.GOING_NAMES_FROM === undefined && /rsvp_named = 1/.test(read('functions/_lib/openHousePlan.js')));
} else check('openHousePlan.js names follow rsvp_named (role R creates the file)', false, 'functions/_lib/openHousePlan.js not there yet');

// ---------------------------------------------------------------- What's New + llms.txt
const whatsNew = read('whats-new.html');
const firstCard = whatsNew.slice(whatsNew.indexOf('<div class="card about-card">'), whatsNew.indexOf('</div>', whatsNew.indexOf('<div class="card about-card">')));
const WN = ["Owners can add yard and sun, parking and garage, and pet details to a home, shown as the owner's own words.", 'Search live listings for RV or boat parking, a wide gate, garage spaces, a workshop or a 240V outlet.',
  'Owners can list their home with other homes on Amico Haus that share its floor plan.', "Plan your drive opens Google Maps from a home's area.",
  "Your open-house plan in the Saved tab: the open houses you RSVP'd to or saved, in your own order, with directions when the owner shares the address.", 'Key pages are now in Spanish: amicohaus.com/es/'];
check("whats-new.html: the home facts card is first, with all six lines", firstCard.includes('<h2>Home facts, Spanish pages and your open-house plan</h2>') && WN.every(l => textOf(firstCard).includes(l)), textOf(firstCard).slice(0, 300));
check('whats-new.html: the new card makes no value/ranking/guarantee claim', !/\bvalue\b|guarantee|verified|best|ideal|score/i.test(textOf(firstCard)));
const llms = read('llms.txt');
check('llms.txt: the Spanish pages line', llms.split('\n').some(l => l.replace(/^- /, '') === 'Spanish pages: https://amicohaus.com/es/ (informational; the English Terms of Use and Privacy Policy control).'));

// ---------------------------------------------------------------- sitemap: exactly the 7 indexable /es/ URLs
const sitemap = await mod('functions/sitemap.xml.js');
const emptyDb = { prepare: () => { const st = { bind: () => st, all: async () => ({ results: [] }), first: async () => null }; return st; } };
const xml = await (await sitemap.onRequestGet({ request: new Request(`${SITE}/sitemap.xml`), env: { DB: emptyDb } })).text();
const urls = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<changefreq>([^<]+)<\/changefreq>\s*<priority>([^<]+)<\/priority>/g)].map(m => ({ loc: m[1], freq: m[2], priority: m[3] }));
const esUrls = urls.filter(u => u.loc.startsWith(`${SITE}/es/`));
const wantEs = PAGES.filter(p => p[4]).map(p => SITE + p[1]);
// The Spanish hold (functions/_lib/spanishLive.js): while SPANISH_LIVE is false nothing Spanish is published.
const { SPANISH_LIVE } = await mod('functions/_lib/spanishLive.js');
const clientFlag = /^const SPANISH_LIVE = (true|false);/m.exec(readFileSync(`${root}/client.js`, 'utf8'));
check('Spanish hold: client.js and functions/_lib/spanishLive.js carry the same switch', !!clientFlag && (clientFlag[1] === 'true') === SPANISH_LIVE, clientFlag && clientFlag[1]);
const buildSrc = readFileSync(`${root}/build-dist.js`, 'utf8');
check('Spanish hold: build-dist reads the switch, leaves es/ out and fails the build if a published page still links to /es/',
  buildSrc.includes("functions', '_lib', 'spanishLive.js'") && buildSrc.includes("fs.rmSync(path.join(OUT, 'es')") && buildSrc.includes('process.exit(1)'));
if (SPANISH_LIVE) {
  check('sitemap: exactly the 7 indexable /es/ URLs (no /es/registro, /es/iniciar-sesion)', JSON.stringify(esUrls.map(u => u.loc).sort()) === JSON.stringify(wantEs.sort()), esUrls.map(u => u.loc).join(', '));
} else {
  check('Spanish hold: the sitemap lists no /es/ URL while the switch is off', esUrls.length === 0, esUrls.map(u => u.loc).join(', '));
  const shell = (await mod('functions/_lib/publicShell.js')).renderPublicShell('t', 'd', '<p>x</p>');
  check('Spanish hold: server-rendered pages carry no Español tab while the switch is off', !shell.includes('/es/') && !shell.includes('tab-lang'));
}
const byLoc = Object.fromEntries(urls.map(u => [u.loc, u]));
const twinOk = PAGES.filter(p => p[4]).every(p => { const e = byLoc[SITE + p[1]], n = byLoc[SITE + p[3]]; return e && n && (p[1] === '/es/' ? e.freq === 'weekly' && e.priority === '0.8' : e.freq === n.freq && e.priority === n.priority); });
if (SPANISH_LIVE) check("sitemap: each /es/ URL mirrors its twin's freq/priority (/es/ weekly 0.8)", twinOk);

// ---------------------------------------------------------------- build-dist: stamping walks nested folders
const build = read('build-dist.js');
const fnSrc = (build.match(/function htmlFilesUnder\(dir\) \{[\s\S]*?\n\}/) || [])[0];
check('build-dist.js: a named htmlFilesUnder(dir) feeds the stamping loop', !!fnSrc && /for \(const file of htmlFilesUnder\(OUT\)\)/.test(build));
check('build-dist.js: the stamping regex and the leading-slash strip are unchanged', build.includes(String.raw`html.replace(/\b(src|href)="((?!https?:|\/\/)[^"?#]+\.(?:js|css))"/g,`) && build.includes(String.raw`path.join(OUT, ref.replace(/^\//, ''))`));
check('build-dist.js: the warning prints the relative path', /const name = path\.relative\(OUT, file\)/.test(build) && build.includes('console.warn(`  ! ${name}: ${ref} not found, left unversioned`)'));
if (fnSrc) {
  const tmp = mkdtempSync(join(tmpdir(), 'es-build-'));
  try {
    mkdirSync(join(tmp, 'es', 'deep'), { recursive: true });
    for (const f of ['index.html', 'es/index.html', 'es/acerca.html', 'es/deep/x.html', 'es/style.css', 'note.txt']) writeFileSync(join(tmp, f), 'x');
    const require = createRequire(import.meta.url);
    const ctx = vm.createContext({ fs: require('fs'), path: require('path') });
    vm.runInContext(`${fnSrc}; this.found = htmlFilesUnder(${JSON.stringify(tmp)});`, ctx);
    const rel = ctx.found.map(f => f.slice(tmp.length + 1).split(/[\\/]/).join('/')).sort();
    check('htmlFilesUnder finds top-level and nested .html files only', JSON.stringify(rel) === JSON.stringify(['es/acerca.html', 'es/deep/x.html', 'es/index.html', 'index.html']), JSON.stringify(rel));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- client.js attribution drops /es
{
  const store = {};
  const noop = () => {};
  const el = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, insertBefore: noop, setAttribute: noop, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null, parentNode: { insertBefore: noop } });
  const landingFor = (pathname) => {
    for (const k of Object.keys(store)) delete store[k];
    const sb = {
      console: { log: noop, warn: noop, error: noop }, URLSearchParams, URL, setTimeout, clearTimeout, atob, btoa, Notification: {}, navigator: { userAgent: 'node' },
      window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '?utm_source=tiktok', pathname, host: 'amicohaus.com' } },
      document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), readyState: 'complete', documentElement: { ...el(), lang: 'es' }, referrer: '' },
      localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
    };
    sb.window.document = sb.document; sb.location = sb.window.location;
    try { vm.createContext(sb); vm.runInContext(read('client.js'), sb, { filename: 'client.js' }); } catch (e) { return `error: ${e.message}`; }
    try { return JSON.parse(store.ah_source).landing; } catch { return null; }
  };
  // Every Spanish page is stored as its English twin (a "/registro" landing would still show a Spanish-page visit).
  const TWINS = { '/es/registro': '/signup', '/es/iniciar-sesion': '/login', '/es/acerca': '/about', '/es/agentes': '/for-agents', '/es/contacto': '/contact',
    '/es/terminos': '/terms', '/es/privacidad': '/privacy', '/es/accesibilidad': '/accessibility', '/es/': '/', '/es': '/', '/es/registro.html': '/signup',
    '/es/registro/': '/signup', '/es/cualquier-otra': '/', '/es/algo/mas': '/' };
  const twinMiss = Object.entries(TWINS).filter(([p, want]) => landingFor(p) !== want).map(([p, want]) => `${p} -> ${landingFor(p)} (want ${want})`);
  check('client.js: a Spanish landing page is stored as its English twin (/es/registro -> /signup ...; anything else under /es -> /)', twinMiss.length === 0, twinMiss.join('; '));
  check('client.js: no stored landing ever starts with /es or names a Spanish page', Object.keys(TWINS).every(p => !/^\/es(\/|$)|registro|iniciar|acerca|agentes|contacto|terminos|privacidad|accesibilidad|cualquier/.test(landingFor(p))));
  check('client.js: /es/ -> "/", and English paths unchanged', landingFor('/es/') === '/' && landingFor('/signup') === '/signup' && landingFor('/estate-tips') === '/estate-tips', `${landingFor('/es/')} ${landingFor('/signup')} ${landingFor('/estate-tips')}`);
}

// ---------------------------------------------------------------- page scripts in a stubbed browser
function pageSandbox({ lang, search = '', ids, apiPost, user = null }) {
  const els = {};
  const mk = (id) => {
    const e = { id, value: '', textContent: '', disabled: false, href: '', innerHTML: '', handlers: {}, children: [],
      classList: { set: new Set(['hidden']), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
      addEventListener(t, fn) { this.handlers[t] = fn; }, append(...n) { this.children.push(...n); } };
    return e;
  };
  for (const id of ids) els[id] = mk(id);
  const toasts = [];
  const sb = {
    console: { log() {}, warn() {}, error() {} }, URLSearchParams, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: lang === 'es' ? '/es/x' : '/x', search, href: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      documentElement: { lang },
      getElementById: (id) => els[id] || (els[id] = mk(id)),
      querySelector: (q) => (/:checked/.test(q) ? { value: 'homeowner' } : { checked: false }),
      querySelectorAll: () => [],
      createElement: () => ({}),
    },
    Object, JSON, Promise, Error,
    apiPost, fetchCurrentUser: async () => user, peekReturnTo: () => '', takeReturnTo: () => null, getAttribution: () => null, inAppBrowser: () => '', escapeHtml: (s) => String(s), toast: (m) => toasts.push(m),
  };
  sb.window = { location: sb.location };
  vm.createContext(sb);
  return { sb, els, toasts };
}
const flush = () => new Promise(r => setImmediate(r));
const SIGNUP_JS = read('page-signup.js'), LOGIN_JS = read('page-login.js'), CONTACT_JS = read('page-contact.js');
for (const lang of ['en', 'es']) {
  let body = null;
  const { sb, els } = pageSandbox({ lang, ids: SIGNUP_IDS, apiPost: async (p, b) => { body = b; return { email: 'a@example.test', emailDelayed: true }; } });
  vm.runInContext(SIGNUP_JS, sb, { filename: 'page-signup.js' });
  els.displayName.value = 'Ana'; els.email.value = 'a@example.test';
  await els.signupForm.handlers.submit({ preventDefault() {} });
  check(`page-signup.js (${lang}): posts uiLang '${lang}', everything else as before`, body && body.uiLang === lang && body.displayName === 'Ana' && body.intent === 'homeowner' && 'source' in body && 'next' in body, JSON.stringify(body));
  check(`page-signup.js (${lang}): the delayed-email note`, els.resendStatus.textContent === (lang === 'es' ? 'Su cuenta está guardada, pero el correo no salió en el primer intento. Espere un minuto y luego toque envíelo de nuevo.' : "Your account is saved, but the email didn't go out on the first try. Give it a minute, then tap send it again."), els.resendStatus.textContent);
  const failing = pageSandbox({ lang, ids: SIGNUP_IDS, apiPost: async () => { throw new Error('That email is already registered — try logging in instead.'); } });
  vm.runInContext(SIGNUP_JS, failing.sb, { filename: 'page-signup.js' });
  await failing.els.signupForm.handlers.submit({ preventDefault() {} });
  const errEl = failing.els.signupError;
  const login = errEl.children.find(c => c && c.href);
  check(`page-signup.js (${lang}): an error shows ${lang === 'es' ? 'the Spanish lead-in + the English detail' : 'the server message as before'}, with the log-in link`,
    errEl.textContent === (lang === 'es' ? 'No se pudo completar. Detalle (en inglés): That email is already registered — try logging in instead.' : 'That email is already registered — try logging in instead.')
    && login && login.href === (lang === 'es' ? '/es/iniciar-sesion' : '/login') && login.textContent === (lang === 'es' ? 'Iniciar sesión' : 'Log in')
    && failing.els.submitBtn.textContent === (lang === 'es' ? 'Enviarme un enlace' : 'Email Me a Link'), `${errEl.textContent} | ${login && login.href}`);

  const lg = pageSandbox({ lang, ids: ['loginForm', 'email', 'password', 'submitBtn', 'twoFactorForm', 'twoFactorCode', 'twoFactorSubmitBtn', 'unconfirmedRow', 'resendLinkBtn'], apiPost: async () => { const e = new Error('Invalid email or password.'); e.data = {}; throw e; } });
  vm.runInContext(LOGIN_JS, lg.sb, { filename: 'page-login.js' });
  await lg.els.loginForm.handlers.submit({ preventDefault() {} });
  check(`page-login.js (${lang}): error toast and button text`, lg.toasts[0] === (lang === 'es' ? 'No se pudo completar. Detalle (en inglés): Invalid email or password.' : 'Invalid email or password.') && lg.els.submitBtn.textContent === (lang === 'es' ? 'Iniciar sesión' : 'Log In'), `${lg.toasts[0]} | ${lg.els.submitBtn.textContent}`);
  const lg2 = pageSandbox({ lang, ids: ['loginForm', 'email', 'resendLinkBtn', 'twoFactorForm'], apiPost: async () => ({ ok: true, message: 'If that address is waiting for confirmation, a new link is on its way.' }) });
  vm.runInContext(LOGIN_JS, lg2.sb, { filename: 'page-login.js' });
  await lg2.els.resendLinkBtn.handlers.click();
  check(`page-login.js (${lang}): the resend answer`, lg2.toasts[0] === (lang === 'es' ? 'Si esa dirección está esperando confirmación, va en camino un enlace nuevo.' : 'If that address is waiting for confirmation, a new link is on its way.'), lg2.toasts[0]);

  const ct = pageSandbox({ lang, ids: ['contactForm', 'name', 'email', 'phone', 'message', 'submitBtn', 'contactError', 'resultNote', 'authCta'], apiPost: async () => ({ ok: true }), user: { displayName: 'Ana' } });
  vm.runInContext(CONTACT_JS, ct.sb, { filename: 'page-contact.js' });
  await flush();
  await ct.els.contactForm.handlers.submit({ preventDefault() {} });
  check(`page-contact.js (${lang}): thanks note and signed-in header`, ct.els.resultNote.textContent === (lang === 'es' ? 'Gracias. Rudy le responderá pronto.' : 'Thanks — Rudy will get back to you soon.')
    && ct.els.authCta.innerHTML === (lang === 'es' ? '<span class="tiny">Hola, Ana</span> <a class="btn btn-primary btn-sm" href="/app">Ir a la aplicación (en inglés)</a>' : '<span class="tiny">Hi, Ana</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>'), `${ct.els.resultNote.textContent} | ${ct.els.authCta.innerHTML}`);
}
check('page scripts: only ES_-prefixed new top-level names', [SIGNUP_JS, LOGIN_JS, CONTACT_JS].every(s => [...s.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]).filter(n => /^ES_/.test(n)).length === 3));

// ---------------------------------------------------------------- ui_lang: signup, email, resend, /api/me
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(read('schema.sql'));
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
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return new Response('{"id":"x"}', { status: 200 }); };
console.log = () => {};
const env = { DB, RESEND_API_KEY: 'key' };
let ipN = 20;
const post = async (handler, path, body, cookie = null) => {
  const request = new Request(`${SITE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `203.0.113.${ipN++}`, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const res = await handler({ request, env, params: {}, waitUntil() {} });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};
const signup = (await mod('functions/api/auth/signup.js')).onRequestPost;
const resend = (await mod('functions/api/auth/resend-confirmation.js')).onRequestPost;

let r = await post(signup, '/api/auth/signup', { displayName: 'Ana Ruiz', email: 'ana@example.test', intent: 'homeowner', uiLang: 'es', source: { utm_source: 'tiktok', landing: '/registro' } });
let row = one("SELECT * FROM users WHERE email = 'ana@example.test'");
let mail = sent.at(-1);
check("signup with uiLang 'es' stores ui_lang 'es'", r.status === 201 && row && row.ui_lang === 'es', JSON.stringify(r.json));
check('...and sends the Spanish email (subject, greeting, code line, button)', mail && mail.subject === 'Confirme su correo para terminar de registrarse' && mail.text.startsWith('Hola Ana Ruiz,\n\n¡Le damos la bienvenida a Amico Haus!')
  && /Escriba este código en la página de registro: \d{3} \d{3}/.test(mail.text) && mail.html.includes('>Confirmar mi correo</a>') && mail.html.includes('O pegue este enlace en su navegador:') && /\/verify-email\?token=[0-9a-f]{64}&as=homeowner/.test(mail.text), mail && mail.text);
check('...intent, source and Terms version stored as for English', row.signup_intent === 'homeowner' && JSON.parse(row.signup_source).utm_source === 'tiktok' && row.terms_version === T.CURRENT_TERMS_VERSION);
r = await post(signup, '/api/auth/signup', { displayName: 'Fred', email: 'fred@example.test', uiLang: 'fr' });
row = one("SELECT * FROM users WHERE email = 'fred@example.test'");
check("uiLang 'fr' -> 'en' and the English email", row && row.ui_lang === 'en' && sent.at(-1).subject === 'Confirm your email to finish signing up');
r = await post(signup, '/api/auth/signup', { displayName: 'Fred', email: 'fred@example.test', uiLang: 'es' });
check("signing up again (still pending) from the Spanish page switches ui_lang to 'es'", one("SELECT ui_lang FROM users WHERE email = 'fred@example.test'").ui_lang === 'es');
sqlite.prepare("UPDATE users SET ui_lang = 'en' WHERE email = 'fred@example.test'").run();
r = await post(signup, '/api/auth/signup', { displayName: 'Nadie', email: 'none@example.test' });
check('no uiLang -> en', one("SELECT ui_lang FROM users WHERE email = 'none@example.test'").ui_lang === 'en');

// The English email, byte for byte the same as before this batch (template from HEAD a2e4e6f; only the link and code vary).
{
  await post(signup, '/api/auth/signup', { displayName: 'Jo <b>', email: 'jo@example.test', intent: 'agent' });
  const m = sent.at(-1);
  const link = (m.text.match(/https:\/\/amicohaus\.com\/verify-email\?token=[0-9a-f]{64}&as=agent/) || [])[0];
  const spaced = (m.text.match(/instead: (\d{3} \d{3})$/m) || [])[1];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const { escapeHtml } = await mod('functions/_lib/util.js');
  const name = 'Jo <b>';
  const wantText = [`Hi ${name},`, '', 'Welcome to Amico Haus! Open this link to confirm your email and finish creating your account:', '', link, '',
    `Signed up inside TikTok, Instagram or Facebook? Type this code on the sign-up page instead: ${spaced}`, '',
    "The link works once and expires in 24 hours. If you didn't sign up, you can ignore this email — nothing will be created."].join('\n');
  const wantHtml = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2128">
  <p style="font-size:16px">Hi ${escapeHtml(name)},</p>
  <p style="font-size:16px">Welcome to Amico Haus! Confirm your email to finish creating your account.</p>
  <p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#a9793f;color:#201404;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9px;display:inline-block">Confirm my email</a></p>
  <p style="font-size:15px">Signed up inside TikTok, Instagram or Facebook? Type this code on the sign-up page instead:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 24px">${spaced}</p>
  <p style="font-size:13px;color:#667085">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
  <p style="font-size:13px;color:#667085">The link works once and expires in 24 hours. If you didn't sign up, you can ignore this email — nothing will be created.</p>
</div>`;
  check('the English confirmation email is byte-identical to HEAD (text, HTML, subject)', !!link && !!spaced && m.text === wantText && m.html === wantHtml && m.subject === 'Confirm your email to finish signing up', m.text);
  check('...and the name is escaped in the HTML', m.html.includes('Jo &lt;b&gt;') && !m.html.includes('Jo <b>') && esc('x') === 'x');
}
// Spanish with no name: "Hola,"
{
  const { sendConfirmationLink } = await mod('functions/_lib/emailConfirmation.js');
  sqlite.prepare("INSERT INTO users (email, display_name, email_confirmation_pending, referral_code, ui_lang) VALUES ('nn@example.test', '', 1, 'NN00001', 'es')").run();
  const id = one("SELECT id FROM users WHERE email = 'nn@example.test'").id;
  await sendConfirmationLink({ env, request: new Request(`${SITE}/x`) }, { id, email: 'nn@example.test', displayName: '' }, { uiLang: 'es' });
  check('Spanish email with no name starts "Hola,"', sent.at(-1).text.startsWith('Hola,\n') && sent.at(-1).html.includes('<p style="font-size:16px">Hola,</p>'));
  check('Spanish email: exact lines', sent.at(-1).text.endsWith('El enlace funciona una sola vez y vence en 24 horas. Si usted no se registró, puede ignorar este correo; no se creará nada.')
    && sent.at(-1).text.includes('\n\n¡Le damos la bienvenida a Amico Haus! Abra este enlace para confirmar su correo y terminar de crear su cuenta:\n\n'));
}
// Resend uses the stored ui_lang.
sqlite.prepare("UPDATE users SET verify_sent_at = NULL").run();
r = await post(resend, '/api/auth/resend-confirmation', { email: 'ana@example.test' });
check("resend for a pending 'es' account sends the Spanish email", r.status === 200 && sent.at(-1).subject === 'Confirme su correo para terminar de registrarse' && sent.at(-1).text.startsWith('Hola Ana Ruiz,'), sent.at(-1).subject);
r = await post(resend, '/api/auth/resend-confirmation', { email: 'fred@example.test', intent: 'agent' });
check("resend for an 'en' account sends the English email (intent kept)", r.status === 200 && sent.at(-1).subject === 'Confirm your email to finish signing up' && /&as=agent/.test(sent.at(-1).text));
check('resend-confirmation.js selects ui_lang in its explicit column list', read('functions/api/auth/resend-confirmation.js').includes("'SELECT id, email, display_name, email_confirmation_pending, ui_lang FROM users WHERE email = ?'"));

// Display language never touches preferred_language, agent languages or alerts.
const code = (f) => read(f).replace(/\/\/.*$/gm, '');
check('signup.js and me.js never touch preferred_language, languages_json or alert language (code, not comments)', !/preferred_language|languages_json|language_filter/.test(code('functions/api/auth/signup.js')) && !/preferred_language|languages_json/.test(code('functions/api/me.js')));

// /api/me GET/PUT round-trip.
sqlite.prepare("INSERT INTO users (id, email, display_name, bio) VALUES (900, 'me@example.test', 'Me', 'my bio')").run();
sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES ('t900', 900, datetime('now', '+1 day'))").run();
const me = await mod('functions/api/me.js');
const meCall = async (method, body) => {
  const request = new Request(`${SITE}/api/me`, { method, headers: { Cookie: 'ah_session=t900', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const res = await (method === 'GET' ? me.onRequestGet : me.onRequestPut)({ request, env, params: {}, waitUntil() {} });
  return { status: res.status, json: await res.json(), cc: res.headers.get('Cache-Control') || '' };
};
r = await meCall('GET');
check("/api/me GET: uiLang 'en' by default, private no-store", r.status === 200 && r.json.user.uiLang === 'en' && /private/.test(r.cc) && /no-store/.test(r.cc), JSON.stringify(r.json));
r = await meCall('PUT', { uiLang: 'es' });
check("/api/me PUT uiLang 'es': stored, in the response next to publicUser, other fields kept", r.status === 200 && r.json.user.uiLang === 'es' && r.json.user.bio === 'my bio' && r.json.user.displayName === 'Me' && one('SELECT ui_lang, bio FROM users WHERE id = 900').ui_lang === 'es', JSON.stringify(r.json));
r = await meCall('PUT', { uiLang: 'fr', bio: 'new bio' });
check("/api/me PUT uiLang 'fr' keeps the stored 'es'", r.json.user.uiLang === 'es' && one('SELECT ui_lang, bio FROM users WHERE id = 900').ui_lang === 'es' && one('SELECT bio FROM users WHERE id = 900').bio === 'new bio');
r = await meCall('PUT', { bio: 'x' });
check('/api/me PUT without uiLang keeps it', one('SELECT ui_lang FROM users WHERE id = 900').ui_lang === 'es' && r.json.user.uiLang === 'es');
r = await meCall('GET');
check("/api/me GET after: uiLang 'es'", r.json.user.uiLang === 'es');
const { publicUser } = await mod('functions/_lib/auth.js');
check('publicUser (auth.js) is unchanged: no uiLang in it', !('uiLang' in publicUser({ id: 1, ui_lang: 'es' })));

// ui_lang is read or written only in the allowed files.
const ALLOWED = ['functions/api/auth/signup.js', 'functions/api/auth/resend-confirmation.js', 'functions/_lib/emailConfirmation.js', 'functions/api/me.js', 'functions/api/account/export.js'];
const users = [];
(function walk(d) { for (const f of readdirSync(join(root, d))) { const p = `${d}/${f}`; if (statSync(join(root, p)).isDirectory()) walk(p); else if (p.endsWith('.js') && /ui_lang/.test(read(p))) users.push(p); } })('functions');
check('ui_lang appears in functions/ only in signup, resend-confirmation, emailConfirmation, me and export', users.every(f => ALLOWED.includes(f)), users.join(', '));

globalThis.fetch = realFetch;
console.log = realLog;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
