// Open For (nuanced ideas batch, migration_v47): uses an owner would consider hearing about on a property (open_for).
// "Not an offer to lease": no price, no term, no promise, no address, and the site never says what a use pays. Day
// and month-to-month uses are permissions; antenna, solar and sign deals are long leases an owner can tick only
// after ticking that they read the long-lease notes. Minerals, oil and gas are not a flag (an idea card only).
import { clampString, parseJsonSafe } from './util.js';
import { validZip } from './ideaText.js';
import { outlineTextProblem, priceOrTermProblem, cityProblem } from './dealOutlines.js';
import { notBlockedSql } from './blocks.js';

export const OPEN_FOR_LINE = 'Open to hearing offers for this use. Not an offer to lease.';
export const LIGHT_LINE = 'Day use and month-to-month use are permissions, not leases.';
export const LONG_LINE = "Antenna, solar and sign deals are long leases. They need an attorney and, if you have a mortgage, your lender's consent.";
export const TAX_LINE = 'A lease of 35 years or more, counting renewals, can raise the property tax on the leased part.';
export const OPEN_FOR_CITY_LINE = "Check your city's rules and your HOA before any paid use.";
export const NO_PAY_LINE = 'Amico Haus never estimates what a use pays.';
export const LONG_ACK = "I've read the notes: these are long leases that need an attorney and, if I have a mortgage, my lender's consent.";
export const LONG_ACK_ERROR = 'Tick the box to confirm you read the notes for long leases.';
// The flag has no price or term field, and the owner's note can't carry one either.
export const OPEN_FOR_NOTE_ERROR = "Leave prices, payments and lease lengths out of your note. Open For only says what you're open to hearing about.";
export const MAX_OPEN_FOR = 3;
export const OPEN_FOR_LIMIT_ERROR = 'You can keep up to 3 Open For flag sets.';

export const OPEN_FOR_KINDS = { home: 'A home', vacant_lot: 'A vacant lot', rural_land: 'Rural land', commercial: 'A commercial property' };
const ALL_KINDS = Object.keys(OPEN_FOR_KINDS);
const LIABILITY_NOTE = 'Charging for hunting or recreation changes your liability. Ask your insurance agent first.';
// type decides the lines a flag set shows; kinds = the property kinds that may tick the use.
export const OPEN_FOR_USES = {
  filming: { label: 'Filming or photo shoots', type: 'light', kinds: ALL_KINDS, notes: ['By the day, with a location agreement. The production usually pulls the film permit.', 'Ask for a certificate of insurance that names you.'] },
  events: { label: 'Events', type: 'light', kinds: ALL_KINDS, notes: ['By the day. Many cities and HOAs limit paid events at homes.', 'Paid guests are owed full care. Ask your insurance agent first.'] },
  storage_parking: { label: 'Storage or parking', type: 'light', kinds: ALL_KINDS, notes: ['No one may live in a stored vehicle or space.'] },
  garden: { label: 'Garden plots', type: 'light', kinds: ALL_KINDS, notes: [] },
  grazing: { label: 'Grazing', type: 'light', kinds: ['rural_land', 'vacant_lot'], notes: [] },
  beekeeping: { label: 'Beekeeping', type: 'light', kinds: ALL_KINDS, notes: ['Beekeepers register their hives with the county each January and need your approval to place them.'] },
  ev_charging: { label: 'EV charging spot', type: 'light', kinds: ALL_KINDS, notes: ['Hosting a charger can be a short permission. A multi-year site lease with a charging company is a long lease.'] },
  hunting: {
    label: 'Hunting', type: 'light', kinds: ['rural_land'],
    notes: ["Hunters need your written permission and their own license, and can't hunt within 150 yards of an occupied home without the occupant's permission.", 'Hunting for a fee may need a state commercial hunting club license.', LIABILITY_NOTE],
  },
  recreation: { label: 'Recreation (hiking, riding, camping by the day)', type: 'light', kinds: ['rural_land'], notes: [LIABILITY_NOTE] },
  antenna: { label: 'Antenna or small cell site', type: 'long', kinds: ALL_KINDS, notes: [] },
  solar_roof: { label: 'Rooftop solar run by a company', type: 'long', kinds: ALL_KINDS, notes: [] },
  solar_ground: { label: 'Ground solar', type: 'long', kinds: ['rural_land', 'vacant_lot', 'commercial'], notes: [] },
  sign: { label: 'A sign', type: 'long', kinds: ALL_KINDS, notes: ["Signs for someone else's business usually aren't allowed in residential zones, and signs you can see from a highway need a state permit first."] },
};
// A few fixed-choice facts (all optional). No price, term, rent or mortgage field exists.
export const OPEN_FOR_FACTS = {
  lotSize: { label: 'Lot size', choices: { under_quarter: 'under ¼ acre', quarter_to_1: '¼ to 1 acre', '1_to_5': '1 to 5 acres', '5_to_20': '5 to 20 acres', over_20: 'over 20 acres' } },
  hoa: { label: 'In an HOA', choices: { yes: 'yes', no: 'no' } },
  roadAccess: { label: 'Road access', choices: { paved: 'paved', dirt: 'dirt' } },
  fenced: { label: 'Fenced', choices: { yes: 'yes', no: 'no' } },
  water: { label: 'Water on the property', choices: { yes: 'yes', no: 'no' } },
  roof: { label: 'Roof', choices: { shingle: 'shingle', tile: 'tile', flat: 'flat', metal: 'metal' } },
};

const isUse = (k) => Object.hasOwn(OPEN_FOR_USES, k);
export function openForUseLabel(key) { return isUse(key) ? OPEN_FOR_USES[key].label : ''; }
export function openForKindLabel(kind) { return Object.hasOwn(OPEN_FOR_KINDS, kind) ? OPEN_FOR_KINDS[kind] : 'A property'; }
// The watch-area digest's name for a flag set (its title column is the property kind).
export const openForDigestLabel = openForKindLabel;

// The lines a flag set shows: always the first three; with any light use the permissions line; with any long use
// the long-lease and property-tax lines.
export function openForLines(uses) {
  const list = (Array.isArray(uses) ? uses : []).filter(isUse);
  const lines = [OPEN_FOR_LINE, OPEN_FOR_CITY_LINE, NO_PAY_LINE];
  if (list.some(k => OPEN_FOR_USES[k].type === 'light')) lines.push(LIGHT_LINE);
  if (list.some(k => OPEN_FOR_USES[k].type === 'long')) lines.push(LONG_LINE, TAX_LINE);
  return lines;
}
// The facts as "(owner says)" lines, in the fixed order, then the owner's note.
export function openForFactLines(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const lines = [];
  for (const [key, def] of Object.entries(OPEN_FOR_FACTS)) {
    if (Object.hasOwn(def.choices, f[key])) lines.push(`${def.label} (owner says): ${def.choices[f[key]]}`);
  }
  if (f.note) lines.push(`Owner's note: ${f.note}`);
  return lines;
}

// What the routes send for one row. mine: the owner's own copy (adds its status); otherwise the search card, with
// the owner's id and display name for Messages. Never an address (none is stored).
export function openForFromRow(row, { mine = false } = {}) {
  const uses = (parseJsonSafe(row.uses_json, []) || []).filter(isUse);
  const stored = parseJsonSafe(row.facts_json, {}) || {};
  const facts = {};
  for (const [key, def] of Object.entries(OPEN_FOR_FACTS)) if (Object.hasOwn(def.choices, stored[key])) facts[key] = stored[key];
  if (typeof stored.note === 'string' && stored.note) facts.note = stored.note;
  const card = {
    id: row.id, propertyKind: row.property_kind, propertyKindLabel: openForKindLabel(row.property_kind), uses, facts,
    city: row.city || '', state: row.state || '', zip: row.zip || '',
    useLabels: uses.map(openForUseLabel), lines: openForLines(uses), factLines: openForFactLines(facts),
  };
  if (mine) Object.assign(card, { status: row.status, createdAt: row.created_at, updatedAt: row.updated_at });
  else card.owner = { id: row.user_id, name: row.owner_name || '' };
  return card;
}

// -> { data } | { error }. existing = the stored row on an edit (fields the body leaves out keep their value; the
// long-lease box is never taken from the stored row). Uses the property kind can't tick are dropped.
export function validateOpenFor(input, { existing = null } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const src = existing ? { ...openForFromRow(existing, { mine: true }), ...body } : body;
  const propertyKind = String(src.propertyKind || '');
  if (!Object.hasOwn(OPEN_FOR_KINDS, propertyKind)) return { error: 'Pick what kind of property this is.' };
  const uses = [...new Set((Array.isArray(src.uses) ? src.uses : []).map(String))].filter(k => isUse(k) && OPEN_FOR_USES[k].kinds.includes(propertyKind)).slice(0, 13);
  if (!uses.length) return { error: 'Pick at least one use.' };
  const hasLong = uses.some(k => OPEN_FOR_USES[k].type === 'long');
  // The box is needed whenever the uses are sent; a save that leaves them alone (Pause) rides on the stored tick.
  const keptTick = !!existing && body.uses === undefined && (parseJsonSafe(existing.facts_json, {}) || {}).longAck === true;
  if (hasLong && body.longAck !== true && !keptTick) return { error: LONG_ACK_ERROR };

  const zip = clampString(src.zip, 10);
  if (!validZip(zip)) return { error: 'Add your 5-digit ZIP code.' };
  const city = clampString(src.city, 60);
  const cityError = cityProblem(city);
  if (cityError) return { error: cityError };
  const state = clampString(src.state || 'CA', 10).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return { error: 'State should be 2 letters.' };

  const given = src.facts && typeof src.facts === 'object' ? src.facts : {};
  const facts = {};
  for (const [key, def] of Object.entries(OPEN_FOR_FACTS)) if (Object.hasOwn(def.choices, given[key])) facts[key] = given[key];
  const note = clampString(given.note, 200);
  const noteError = outlineTextProblem(note);
  if (noteError) return { error: noteError };
  if (priceOrTermProblem(note)) return { error: OPEN_FOR_NOTE_ERROR };
  if (note) facts.note = note;
  if (hasLong) facts.longAck = true;
  const status = src.status === 'paused' ? 'paused' : 'active';
  return { data: { propertyKind, uses, zip, city, state, facts, status } };
}

// Everything the Open For form and cards in ideas.js print, so the wording lives in one place (this file).
export function openForConfig() {
  return {
    openForLine: OPEN_FOR_LINE, lightLine: LIGHT_LINE, longLine: LONG_LINE, taxLine: TAX_LINE, cityLine: OPEN_FOR_CITY_LINE, noPayLine: NO_PAY_LINE, longAck: LONG_ACK,
    kinds: Object.entries(OPEN_FOR_KINDS).map(([key, label]) => ({ key, label })),
    uses: Object.entries(OPEN_FOR_USES).map(([key, u]) => ({ key, label: u.label, type: u.type, kinds: u.kinds, notes: u.notes })),
    facts: Object.entries(OPEN_FOR_FACTS).map(([key, f]) => ({ key, label: f.label, choices: Object.entries(f.choices).map(([k, label]) => ({ key: k, label })) })),
    max: MAX_OPEN_FOR,
  };
}

// The Open For term of the watch-area digest (watchAreas.js reads it). Columns kind, ref_id, zip, title (the
// property kind: openForDigestLabel gives its label), created_at. Params: ?1 viewer id, ?2 DEMO_EMAIL_PATTERN,
// ?4 now minus 30 days.
export function openForDigestTermSql() {
  return `SELECT * FROM (SELECT 'open_for' AS kind, f.id AS ref_id, f.zip AS zip, f.property_kind AS title, f.created_at AS created_at FROM open_for f JOIN users u ON u.id = f.user_id
    WHERE f.status = 'active' AND f.user_id != ?1 AND u.status = 'active' AND u.email NOT LIKE ?2
      AND f.created_at > ?4 AND f.zip IN (SELECT zip FROM watch_areas WHERE user_id = ?1) AND ${notBlockedSql('f.user_id', '?1')}
    ORDER BY f.created_at DESC LIMIT 20)`;
}
