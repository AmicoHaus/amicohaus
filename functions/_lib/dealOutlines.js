// Easement Ideas (nuanced ideas batch, migration_v47): an owner's NON-BINDING idea outline in their own words
// (deal_outlines). "Not an easement. A real one is written by an attorney and recorded." The site lists options and
// never recommends one, never writes or fills in a legal document, names no attorney (only the State Bar's lawyer
// referral page) and never says what a use pays. Every listing is free and is for one buyer or user: co-ownership
// outlines are never listed. No address and no parcel number is stored.
import { clampString, escapeHtml, parseJsonSafe, DEMO_EMAIL_PATTERN } from './util.js';
import { foldAccents } from './homeText.js';
import { ideaTextProblem, validZip, HOA_CITY_LINE, INVEST_ERROR } from './ideaText.js';
import { notBlockedSql } from './blocks.js';

export const OUTLINE_LABELS = [
  'This is an idea outline. It is not an easement, lease, or contract.',
  'Not an easement. A real one is written by an attorney and recorded with the county.',
  'Nothing here is binding on you or anyone else.',
];
export const SKETCH_LINE = 'Your sketch is a rough picture. It is not a survey.';
export const ASK_LINE = 'Asking price is your own number. It is not an appraisal.';
// The same two lines as another member reads them on a listed outline (the number and the sketch are the owner's).
export const SKETCH_VIEWER_LINE = "The owner's sketch is a rough picture. It is not a survey.";
export const ASK_VIEWER_LINE = "The ask is the owner's own number. It is not an appraisal.";
export const NO_RECOMMEND_LINE = "This form starts on the lightest option. Amico Haus doesn't recommend one. A California attorney can tell you which option fits your property.";
export const LISTING_LINES = ['Listing by the owner. Amico Haus does not negotiate or take part in the deal.', 'For one buyer or user. Not an investment offering.'];
export const POOL_LINE = 'Sharing a pool with more than three households, or for a fee, can make it a public pool under health rules. Ask your county health department.';
export const LIST_ACK = "I understand Amico Haus doesn't negotiate, write documents or take part in any deal, and that this outline isn't an offer.";
export const PACKET_LINES = ['Take your packet to any California attorney you choose.', 'Find a certified lawyer referral service at the State Bar of California.', 'Amico Haus does not write legal documents.'];
export const STATE_BAR_LRS_URL = 'https://www.calbar.ca.gov/public/find-legal-professionals/find-lawyer-referral-service';
export const SKETCH_LEGEND = 'Lighter squares: the idea. Darker squares: the house.';

export const MAX_OUTLINES = 5;
export const MAX_LISTED_OUTLINES = 3;
export const OUTLINE_LIMIT_ERROR = 'You can keep up to 5 idea outlines.';
export const LISTED_LIMIT_ERROR = 'You can list up to 3 idea outlines.';
export const LIST_ACK_ERROR = 'Tick the box to list your outline.';

// The ladder: a fixed list of options, each with ITS notes. The form starts on the first of its ladder (Rudy's rule:
// the version that needs no filing and no consent). No option is described as easier, better or safer than another.
export const TERM_OPTIONS = {
  month_to_month: {
    label: 'Month-to-month use (this form starts here)',
    notes: ['Default: month-to-month permission to use the space. Either side can end it with notice.', 'No one may live in the space.', 'Ask your insurance agent before anyone uses your property.'],
  },
  lease_3yr: {
    label: 'A lease of up to 3 years, with no option to buy',
    notes: ['A lease longer than one year has to be in writing, and is usually recorded so it holds up with a later buyer or lender.', 'Leasing part of a lot can raise a subdivision question with your city. Ask an attorney and your city first.'],
  },
  recorded_easement: {
    label: 'A recorded easement',
    notes: ["A recorded easement needs an attorney, a surveyor, and usually your lender's consent.", "Without your lender's consent, a foreclosure can erase an easement.", 'An easement that gives someone else the only use of part of your lot needs extra review by an attorney and your city.'],
  },
  long_lease: {
    label: 'A long lease (more than 3 years)',
    notes: ["A lease longer than 3 years, or any lease with an option to buy, usually needs your mortgage lender's written consent.", 'A lease of 35 years or more can raise the property tax on the leased part.', 'In California a lease of a city lot cannot run longer than 99 years.', 'A long lease of part of a lot has the most rules of these options. Ask an attorney and your city before anything else.'],
  },
  co_2_4: {
    label: '2 to 4 co-owners (this form starts here)',
    notes: ['Default: 2 to 4 co-owners.', 'Adding a co-owner can affect your mortgage and your property tax. Ask your lender and an attorney first.', 'A co-ownership agreement is written by an attorney.'],
  },
  co_5_plus: {
    label: '5 or more ownership shares',
    notes: ['Five or more ownership shares need a state filing. Not offered here.', "You can still print this outline for your attorney. It can't be listed."],
  },
  co_time_based: {
    label: 'Shares that give each owner set weeks or months',
    notes: ["Time-based shares can fall under California's time-share rules or its rules for five or more shares, and some cities treat them as time-shares. Not offered here.", "You can still print this outline for your attorney. It can't be listed."],
  },
};
const SPACE_LADDER = ['month_to_month', 'lease_3yr', 'recorded_easement', 'long_lease'];
// v1 offers three kinds. 'view_sun' is in the table's CHECK for later (parked) and is refused here.
export const OUTLINE_KINDS = {
  space: {
    label: 'Use of a space',
    uses: { rv_boat: 'RV or boat parking', parking: 'Car parking', storage: 'Storage', garden: 'A garden plot', workshop: 'Workshop or studio space', court: 'A sport court', pool: 'A pool', other: 'Something else' },
    ladder: SPACE_LADDER,
  },
  access: {
    label: 'A way across',
    uses: { driveway: 'A shared driveway', side_path: 'A path along the side yard', utility: 'A utility line', other: 'Something else' },
    ladder: SPACE_LADDER,
  },
  co_ownership: {
    label: 'Sharing ownership',
    uses: { whole_home: 'Co-owning the whole home' },
    ladder: ['co_2_4', 'co_5_plus', 'co_time_based'],
  },
};
export const QUESTIONS = {
  lender: "Do I need my lender's consent?",
  hoa: 'Do my HOA rules allow it?',
  city: 'Does my city allow it, and does it need a permit?',
  insurance: 'What insurance should each side carry?',
  tax: 'Could it change my property tax?',
  ending: 'How does either side end it?',
  sale: 'What happens if I sell my home?',
  survey: 'Do we need a surveyor?',
};
export const ASK_PER = { day: 'a day', month: 'a month', year: 'a year', once: 'one time' };
export const ASK_MAX = 50000000;
export const WHO_TO_ASK = ['My mortgage lender', 'My HOA', "My city's planning office", 'My insurance agent', 'A California attorney', 'A licensed land surveyor', 'A title company'];

// "Shares" in the ownership sense is investment talk too (INVEST_ERROR names it; ideaText.js catches "fractional").
// "A shared driveway" and "share the garden" pass.
const SHARES_RE = /\b\d+\s+shares\b|\bshares? (of|in) (the |my |our )?(lot|land|property|home|house|ownership|rent|income|profits?)\b|\b(sell|selling|buy|buying|offer|offering|own|owning) (\w+ )?shares\b|\bownership shares?\b/i;
// A lease buyout or any sale of a rent stream is never listed here (securities; the buyout card says so): "Tower
// lease buyout: take over the rent", "rent for sale", "buy my lease payments", "earn money from my lot". "Garage bay
// for rent by the month" and "take over the back corner for a garden" pass.
const BUYOUT_RE = /\b(buy-?outs?|take over the (rent|lease)|rent (payments? )?for sale|(sell|selling|buy|buying) (the |my |a |this )?(monthly )?(rents?|lease payments?|income)|earn (money|income)|monthly income)\b/i;
// The check every free-text field of an outline or an Open For flag set runs: ideaText.js plus the shares and
// buyout wording.
export function outlineTextProblem(text, opts) {
  const f = foldAccents(text);
  return ideaTextProblem(text, opts) || (SHARES_RE.test(f) || BUYOUT_RE.test(f) ? INVEST_ERROR : null);
}
// A price, what a use pays, or a lease length written into free text. An Open For note and a pool outline leave
// those out on purpose (no price, no term), so their text can't carry them either. Sizes pass ("12 by 40 feet").
const PRICE_TERM_RE = /\$|\b\d[\d,.]*\s?(k|dollars?|usd|bucks|dolares)\b|\b\d[\d,.]*\s?(\/|per |a |an |each |every |por |al )\s?(day|night|week|month|mo|year|yr|dia|noche|semana|mes|ano)\b|\b\d+\s?-?\s?(days?|years?|yrs?|months?|weeks?|dias|anos?|meses)\b|\b(pays?|paid|paying|payments?|income|rent(s|ed|al|als)?|fees?|price[ds]?|pricing|renta|alquiler|pagan?|precio)\b/i;
export function priceOrTermProblem(text) {
  return PRICE_TERM_RE.test(foldAccents(text));
}
// A city is a place name only: letters, spaces, periods, apostrophes and hyphens, at most 5 words (so no address
// and no sentence fits), and it still runs the text checks. A real city whose name holds a checked word is let through.
export const CITY_ERROR = 'City should be a place name, like Chula Vista.';
const CITY_RE = /^[\p{L}][\p{L} .'’-]*$/u;
const CITY_NAMES_OK = new Set(['temple city']);
export function cityProblem(city) {
  const c = String(city || '').trim();
  if (!c) return null;
  if (!CITY_RE.test(c) || c.split(/\s+/).length > 5) return CITY_ERROR;
  if (CITY_NAMES_OK.has(c.toLowerCase())) return null;
  return outlineTextProblem(c, { living: false }) ? CITY_ERROR : null;
}

const GRID = 12;
function cleanCells(list) {
  const out = new Set();
  for (const v of Array.isArray(list) ? list : []) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < GRID * GRID) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
// { cells, house, street } on a 12 x 12 grid: unknown values dropped, deduped, sorted; a cell in both counts as the idea.
export function cleanSketch(input) {
  const src = input && typeof input === 'object' ? input : {};
  const cells = cleanCells(src.cells);
  const taken = new Set(cells);
  const house = cleanCells(src.house).filter(c => !taken.has(c));
  return { cells, house, street: ['top', 'right', 'bottom', 'left'].includes(src.street) ? src.street : '' };
}

function questionsFromJson(text) {
  const v = parseJsonSafe(text, null);
  const keys = Array.isArray(v) ? v : (v && Array.isArray(v.keys) ? v.keys : []);
  return { keys: keys.filter(k => Object.hasOwn(QUESTIONS, k)), own: v && !Array.isArray(v) && typeof v.own === 'string' ? v.own : '' };
}

export function outlineUseLabel(kind, useKey) {
  const k = Object.hasOwn(OUTLINE_KINDS, kind) ? OUTLINE_KINDS[kind] : null;
  return k && Object.hasOwn(k.uses, useKey) ? k.uses[useKey] : '';
}
// A use key's label without its kind (the watch-area digest has only the key): "other" reads the same in both kinds.
export function dealOutlineDigestLabel(useKey) {
  for (const k of Object.values(OUTLINE_KINDS)) if (Object.hasOwn(k.uses, useKey)) return k.uses[useKey];
  return 'An idea';
}

// The lines an outline prints (owner view, browse card, packet), in order. o = an outlineFromRow object.
export function outlineLines(o) {
  const label = outlineUseLabel(o.kind, o.useKey);
  const lines = [o.useKey === 'other' || !label ? (o.useNote || label) : (o.useNote ? `${label}: ${o.useNote}` : label)];
  if (o.areaNote) lines.push(`Where on the lot: ${o.areaNote}`);
  const option = Object.hasOwn(TERM_OPTIONS, o.termOption) ? TERM_OPTIONS[o.termOption] : null;
  if (option) lines.push(`Option the owner is looking at: ${option.label}`);
  if (o.ask && o.ask.amount) lines.push(`Owner's ask: $${Number(o.ask.amount).toLocaleString('en-US')} ${ASK_PER[o.ask.per] || ''}`.trim());
  // A state by itself (the default "CA") isn't an area: the line needs a city or a ZIP.
  const area = o.city || o.zip ? [[o.city, o.state].filter(Boolean).join(', '), o.zip].filter(Boolean).join(' ') : '';
  if (area) lines.push(`Area: ${area}`);
  return lines.filter(Boolean);
}

// What the routes send for one row. mine: the owner's own copy (adds their attorney questions and whether it is
// listed); otherwise the browse card, which carries the owner's id and display name for Messages. Never an address.
export function outlineFromRow(row, { mine = false } = {}) {
  const q = questionsFromJson(row.questions_json);
  const o = {
    id: row.id, kind: row.kind, useKey: row.use_key, useNote: row.use_note || '', areaNote: row.area_note || '', termOption: row.term_option,
    ask: row.ask_amount ? { amount: row.ask_amount, per: row.ask_per || '' } : null,
    sketch: cleanSketch(parseJsonSafe(row.sketch_json, {})), city: row.city || '', state: row.state || '', zip: row.zip || '',
  };
  o.useLabel = outlineUseLabel(o.kind, o.useKey);
  o.lines = outlineLines(o);
  if (mine) Object.assign(o, { questions: q.keys, ownQuestion: q.own, listed: !!row.listed, createdAt: row.created_at, updatedAt: row.updated_at });
  else o.owner = { id: row.user_id, name: row.owner_name || '' };
  return o;
}

// -> { data } | { error }. existing = the stored row on an edit: fields the body leaves out keep their stored value
// (so "Stop listing" can send { listed: false } alone). The box is never taken from the stored row.
export function validateOutline(input, { existing = null } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const src = existing ? { ...outlineFromRow(existing, { mine: true }), ...body } : body;
  const kind = String(src.kind || '');
  if (!Object.hasOwn(OUTLINE_KINDS, kind)) return { error: 'Pick what kind of idea this is.' };
  const def = OUTLINE_KINDS[kind];
  const useKey = String(src.useKey || '');
  if (!Object.hasOwn(def.uses, useKey)) return { error: 'Pick a use from the list.' };
  // Co-owning a home is about living in it, so only that kind skips the "no one may live in the space" check.
  const living = kind !== 'co_ownership';
  const useNote = clampString(src.useNote, 200);
  const areaNote = clampString(src.areaNote, 200);
  if (useKey === 'other' && !useNote) return { error: 'Say what the use is, in a few words.' };
  const textError = outlineTextProblem(useNote, { living }) || outlineTextProblem(areaNote, { living });
  if (textError) return { error: textError };
  // A pool carries no price (POOL_LINE), in the ask box or in the owner's words.
  if (useKey === 'pool' && (priceOrTermProblem(useNote) || priceOrTermProblem(areaNote))) return { error: 'Leave the price out for a pool. ' + POOL_LINE };
  const termOption =src.termOption === undefined || src.termOption === null || src.termOption === '' ? def.ladder[0] : String(src.termOption);
  if (!def.ladder.includes(termOption)) return { error: 'Pick one of the options listed.' };

  let askAmount = null, askPer = '';
  const ask = src.ask && typeof src.ask === 'object' ? src.ask : {};
  if (ask.amount !== undefined && ask.amount !== null && ask.amount !== '') {
    if (useKey === 'pool') return { error: 'Leave the price out for a pool. ' + POOL_LINE };
    askAmount = Number(ask.amount);
    if (!Number.isInteger(askAmount) || askAmount < 1 || askAmount > ASK_MAX) return { error: 'Your ask should be a whole dollar amount, up to $50,000,000.' };
    askPer = String(ask.per || '');
    if (!Object.hasOwn(ASK_PER, askPer)) return { error: 'Pick what your ask is for: a day, a month, a year or one time.' };
    if (kind === 'co_ownership' && askPer !== 'once') return { error: 'For sharing ownership, the ask is a one-time amount.' };
  }

  const keys = [...new Set((Array.isArray(src.questions) ? src.questions : []).map(String))].filter(k => Object.hasOwn(QUESTIONS, k)).slice(0, 8);
  const ownQuestion = clampString(src.ownQuestion, 300);
  const questionError = outlineTextProblem(ownQuestion, { living: false });
  if (questionError) return { error: questionError };

  const zip = clampString(src.zip, 10);
  if (zip && !validZip(zip)) return { error: 'ZIP code should be 5 digits.' };
  const city = clampString(src.city, 60);
  const cityError = cityProblem(city);
  if (cityError) return { error: cityError };
  const state = clampString(src.state || 'CA', 10).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return { error: 'State should be 2 letters.' };

  // A co-ownership outline is never listed, even when asked (one buyer or user per idea; a co-owner search is housing).
  let listed = 0;
  if (src.listed === true && kind !== 'co_ownership') {
    if (!zip) return { error: 'Add your ZIP code to list your outline.' };
    if (body.ack !== true) return { error: LIST_ACK_ERROR };
    listed = 1;
  }
  return {
    data: {
      kind, useKey, useNote, areaNote, termOption, sketch: cleanSketch(src.sketch), askAmount, askPer,
      questions: { keys, own: ownQuestion }, zip, city, state, listed,
    },
  };
}

// The values a validated outline writes, in the column order both the INSERT and the UPDATE use.
export function outlineColumnValues(d) {
  return [d.kind, d.useKey, d.useNote, d.areaNote, JSON.stringify(d.sketch), d.termOption, d.askAmount, d.askPer, JSON.stringify(d.questions), d.zip, d.city, d.state, d.listed];
}
export const OUTLINE_COLUMNS = ['kind', 'use_key', 'use_note', 'area_note', 'sketch_json', 'term_option', 'ask_amount', 'ask_per', 'questions_json', 'zip', 'city', 'state', 'listed'];

// One option of the ladder as HTML (the packet): its label, its notes, then the HOA-and-city line.
export function termOptionHtml(termOption) {
  const option = Object.hasOwn(TERM_OPTIONS, termOption) ? TERM_OPTIONS[termOption] : null;
  if (!option) return '';
  return `<div class="outline-option"><p><strong>${escapeHtml(option.label)}</strong></p><ul class="outline-notes">${
    option.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul><p class="tiny">${escapeHtml(HOA_CITY_LINE)}</p></div>`;
}

// The owner's rough sketch: a 240 x 240 picture of the 12 x 12 grid, with the street side named. Classes and plain
// SVG attributes only (no inline style). ideas.js ideaSketchSvg draws the same picture in the browser.
const SK = { cell: 18, pad: 12 };
const SK_STREET = {
  top: 'x="120" y="6"', bottom: 'x="120" y="234"',
  left: 'x="6" y="120" transform="rotate(-90 6 120)"', right: 'x="234" y="120" transform="rotate(90 234 120)"',
};
export function sketchSvg(sketch) {
  const s = cleanSketch(sketch);
  const area = new Set(s.cells), house = new Set(s.house);
  let rects = '';
  for (let i = 0; i < GRID * GRID; i++) {
    const kind = area.has(i) ? 'sk-area' : house.has(i) ? 'sk-house' : '';
    const fill = kind === 'sk-area' ? '#d9b36c' : kind === 'sk-house' ? '#56616b' : '#ffffff';
    rects += `<rect class="sk-cell${kind ? ' ' + kind : ''}" x="${SK.pad + (i % GRID) * SK.cell}" y="${SK.pad + Math.floor(i / GRID) * SK.cell}" width="${SK.cell}" height="${SK.cell}" fill="${fill}" stroke="#b9c0c7" stroke-width="1"/>`;
  }
  const street = s.street ? `<text class="sk-street" ${SK_STREET[s.street]} text-anchor="middle" dominant-baseline="middle" font-size="9">Street</text>` : '';
  return `<svg class="sketch-grid" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Owner's rough sketch of the lot">${rects}${street}</svg>`;
}

// Everything the builder in ideas.js prints, so the wording lives in one place (this file).
export function outlineConfig() {
  return {
    labels: OUTLINE_LABELS, sketchLine: SKETCH_LINE, sketchLegend: SKETCH_LEGEND, askLine: ASK_LINE, noRecommendLine: NO_RECOMMEND_LINE,
    sketchViewerLine: SKETCH_VIEWER_LINE, askViewerLine: ASK_VIEWER_LINE,
    listingLines: LISTING_LINES, poolLine: POOL_LINE, listAck: LIST_ACK, hoaCityLine: HOA_CITY_LINE,
    kinds: Object.entries(OUTLINE_KINDS).map(([key, k]) => ({
      key, label: k.label, uses: Object.entries(k.uses).map(([u, label]) => ({ key: u, label })),
      ladder: k.ladder.map(t => ({ key: t, label: TERM_OPTIONS[t].label, notes: TERM_OPTIONS[t].notes })),
    })),
    questions: Object.entries(QUESTIONS).map(([key, label]) => ({ key, label })),
    askPer: Object.entries(ASK_PER).map(([key, label]) => ({ key, label })),
    maxOutlines: MAX_OUTLINES, maxListed: MAX_LISTED_OUTLINES,
  };
}

// 1 when the viewer is a seeded demo account (demo rows show only to demo viewers), else 0.
export function viewerIsDemo(user) {
  return String((user && user.email) || '').toLowerCase().endsWith(DEMO_EMAIL_PATTERN.slice(1)) ? 1 : 0;
}

// Who may see a listed outline that isn't their own: listed and active, never a co-ownership outline, its owner
// active, not a demo account (demo viewers see demo rows), and no block either way. ?1 = the viewer's id,
// ?2 = DEMO_EMAIL_PATTERN, ?3 = 1 when the viewer is a demo account. Tables: deal_outlines o, users u.
export const LISTED_OUTLINE_SQL = `o.listed = 1 AND o.status = 'active' AND o.kind != 'co_ownership' AND u.status = 'active'
      AND (u.email NOT LIKE ?2 OR ?3 = 1) AND ${notBlockedSql('o.user_id', '?1')}`;

// The listed-outline term of the watch-area digest (watchAreas.js reads it). Columns kind, ref_id, zip, title (the
// use key: dealOutlineDigestLabel gives its label), created_at. Params: ?1 viewer id, ?2 DEMO_EMAIL_PATTERN, ?4 now minus 30 days.
export function dealOutlineDigestTermSql() {
  return `SELECT * FROM (SELECT 'deal_outline' AS kind, o.id AS ref_id, o.zip AS zip, o.use_key AS title, o.created_at AS created_at FROM deal_outlines o JOIN users u ON u.id = o.user_id
    WHERE o.listed = 1 AND o.status = 'active' AND o.user_id != ?1 AND u.status = 'active' AND u.email NOT LIKE ?2
      AND o.created_at > ?4 AND o.zip IN (SELECT zip FROM watch_areas WHERE user_id = ?1) AND ${notBlockedSql('o.user_id', '?1')}
    ORDER BY o.created_at DESC LIMIT 20)`;
}
