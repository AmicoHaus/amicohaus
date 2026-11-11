// Owner-entered home facts on every kind of home: yard and sun, parking and garage (the "toy box"), pets, and on a
// pre-listing the floor plan (listings keep theirs in the plan_* columns). Stored in home_facts_json; a missing key
// means the owner didn't say (never "no"). Pages always show them as the owner's words under a "(from the owner)"
// heading: the site never computes, measures, checks or vouches for any of them (Rudy's jury test, 11.04).
import { clampString } from './util.js';
import { steeringProblem, STEERING_ERROR, addressProblem, ADDRESS_ERROR, codeProblem, CODE_ERROR, foldAccents } from './homeText.js';
import { HOME_KINDS } from './homeCosts.js';
export { HOME_KINDS };

// Allowed values -> the label pages print. '' / missing = "Not sure": never stored, never shown.
export const DIRECTIONS = { n: 'north', ne: 'northeast', e: 'east', se: 'southeast', s: 'south', sw: 'southwest', w: 'west', nw: 'northwest' };
export const OUTDOOR = { backyard: 'backyard', front_yard: 'front yard', side_yard: 'side yard', patio: 'patio', balcony: 'balcony', deck: 'deck', courtyard: 'courtyard', rooftop: 'rooftop', none: 'none' };
// A bucket only: no square feet anywhere (an exact lot size reads like a county-record claim).
export const YARD_SIZES = { small: 'small', medium: 'medium', large: 'large' };
export const FENCED = { yes: 'yes', partly: 'partly', no: 'no' };
export const AFTERNOON_SUN = { mostly_sun: 'mostly sun', part_shade: 'part sun, part shade', mostly_shade: 'mostly shade' };
export const SHADE = { covered_patio: 'covered patio', pergola: 'pergola', shade_trees: 'shade trees', awning: 'awning' };
export const SOLAR = { none: 'none', owned: 'owned', leased: 'leased' };
export const YES_NO = { yes: 'yes', no: 'no' };
export const RV_SPOTS = { driveway: 'driveway', side_yard: 'side yard', pad: 'pad' };
// A landlord's pet policy: only on a rental listing (dropped everywhere else, so a stale value never shows).
export const RENTAL_PETS = { considered: 'pets considered', some: 'some pets (see notes)', none: 'no pets' };

// Whole-number fields: [min, max, error].
export const GATE_IN_RANGE = [24, 480, 'Gate opening should be whole inches from 24 to 480.'];
export const DRIVEWAY_FT_RANGE = [5, 300, 'Driveway length should be whole feet from 5 to 300.'];
export const GARAGE_RANGE = [0, 10, 'Garage spaces should be a whole number from 0 to 10.'];
// Floor-plan text on a pre-listing (agents read it; it's never matched).
export const PLAN_MAX = { builder: 60, name: 40, community: 60 };

export const NOTE_MAX = 160;
export const PET_ASSIST_ERROR = 'Leave assistance animals out: the site adds the fair-housing note about them itself.';
export const PET_FEE_ERROR = 'Leave pet fees, deposits and pet rent out; those belong in the lease.';
// Matched on folded text, English and Spanish. "ESA" is checked case-sensitively on its own (PET_ESA_RE), because
// "esa"/"esas" is everyday Spanish ("that", "those").
const PET_ASSIST_RE = /\b(service|assistance|support|emotional[- ]support|therapy|companion|guide dogs?|seeing[- ]eye|servicio|asistencia|apoyo|terapia|lazarillos?|acompanamiento)\b/i;
const PET_ESA_RE = /\bESAs?\b/;
const PET_FEE_RE = /\$|\b(fees?|deposits?|rent|charges?|costs?|cuotas?|depositos?|renta|cargos?|costos?)\b/i;

export const YARD_HEADING = 'Yard and sun (from the owner)';
export const YARD_SEASON_LINE = 'Sun changes with the season, trees and nearby buildings, so visit at the time of day that matters to you.';
export const TOY_HEADING = 'Parking and garage (from the owner)';
export const TOY_CONFIRM_LINE = 'Measure and confirm on your visit. HOA and city rules on parking RVs, boats and work trucks vary; check them first.';
export const PETS_HEADING = 'Pets (from the owner)';
// California fair housing law (Gov. Code 12927(c)(1) reasonable accommodation, 12955; 2 CCR 12005, 12176, 12185).
// HUD's FHEO-2020-01 was withdrawn in 2025, so it isn't cited. Never "generally": a hedge reads like permission to
// refuse. Not "pet rules don't apply" either: leash, waste and conduct rules can still apply to any animal, so the
// line names only pet limits and pet charges, and says how a request is handled. Attorney review: Q3.
export const ASSISTANCE_ANIMAL_LINE = "Assistance animals (service and support animals) are not pets, and pet limits and pet fees don't apply to them. Under California fair housing law, a request to keep one is handled as a reasonable accommodation.";
export const ASSISTANCE_ANIMAL_LINE_LONG = "Assistance animals (service and support animals) are not pets, and pet limits, pet deposits and pet fees don't apply to them. Under California fair housing law, a request to keep one is handled as a reasonable accommodation (Cal. Gov. Code §§ 12927, 12955; Cal. Code Regs. tit. 2, §§ 12005, 12176, 12185).";
export const PET_FORM_HELP = "Assistance animals (service and support animals) aren't pets, so leave them out of your pet rules. The site adds a fair-housing note about them wherever your pet rules show.";

export const PLAN_DRIVE_LABEL = 'Plan your drive';
export const PLAN_DRIVE_CAPTION = "Opens Google Maps, which works out the drive time; Amico Haus doesn't. It goes to the home's area, not its address.";

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (map, v) => (typeof v === 'string' && Object.hasOwn(map, v) ? v : undefined);
const pickList = (map, v) => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && Object.hasOwn(map, x)))] : []);
// Blank = not given; anything else must be a whole number in range (an error when typed, dropped when read back).
function wholeNumber(v, [min, max, error]) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return { value: undefined };
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN);
  if (!Number.isInteger(n) || n < min || n > max) return { error };
  return { value: n };
}
// The fair-housing, address and code checks every piece of owner text gets (English and Spanish, homeText.js).
function textProblem(text) {
  if (steeringProblem(text)) return STEERING_ERROR;
  if (addressProblem(text)) return ADDRESS_ERROR;
  if (codeProblem(text)) return CODE_ERROR;
  return null;
}
function petNotesProblem(text) {
  const t = textProblem(text);
  if (t) return t;
  const f = foldAccents(text);
  if (PET_ASSIST_RE.test(f) || PET_ESA_RE.test(String(text))) return PET_ASSIST_ERROR;
  if (PET_FEE_RE.test(f)) return PET_FEE_ERROR;
  return null;
}
// Keeps only the keys that have a value, so an empty group is left out.
function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}

// The shape rules, shared by the validator (checkText: true, numbers out of range are errors) and by reading a row
// back (checkText: false, bad values dropped). kind null = reading back: plan and rental pets are kept when valid.
function shapeFacts(input, { kind = null, isRental = false, checkText = true } = {}) {
  const src = isObj(input) ? input : {};
  const y = isObj(src.yard) ? src.yard : {}, t = isObj(src.toy) ? src.toy : {}, p = isObj(src.pets) ? src.pets : {};
  const pl = isObj(src.plan) ? src.plan : {};
  const num = (v, range) => {
    const r = wholeNumber(v, range);
    if (r.error && checkText) throw new FactsError(r.error);
    return r.error ? undefined : r.value;
  };
  const note = (v, max, check) => {
    const s = clampString(typeof v === 'string' ? v : '', max);
    if (!s) return undefined;
    if (checkText) { const e = check(s); if (e) throw new FactsError(e); }
    return s;
  };

  let outdoor = pickList(OUTDOOR, y.outdoor);
  if (outdoor.length > 1) outdoor = outdoor.filter(x => x !== 'none');
  const yard = compact({
    faces: pick(DIRECTIONS, y.faces), frontFaces: pick(DIRECTIONS, y.frontFaces), outdoor,
    size: pick(YARD_SIZES, y.size), fenced: pick(FENCED, y.fenced), afternoonSun: pick(AFTERNOON_SUN, y.afternoonSun),
    shade: pickList(SHADE, y.shade), solar: pick(SOLAR, y.solar), notes: note(y.notes, NOTE_MAX, textProblem),
  });

  const rv = pick(YES_NO, t.rv);
  const garage = num(t.garage, GARAGE_RANGE);
  const toy = compact({
    rv, rvSpot: rv === 'yes' ? pick(RV_SPOTS, t.rvSpot) : undefined, sideAccess: pick(YES_NO, t.sideAccess),
    gateIn: num(t.gateIn, GATE_IN_RANGE), drivewayFt: num(t.drivewayFt, DRIVEWAY_FT_RANGE), garage,
    tandem: garage ? pick(YES_NO, t.tandem) : undefined, workshop: pick(YES_NO, t.workshop), ev240: pick(YES_NO, t.ev240),
  });

  const rentalOk = kind === null || (kind === 'listing' && isRental);
  const pets = compact({ rental: rentalOk ? pick(RENTAL_PETS, p.rental) : undefined, notes: note(p.notes, NOTE_MAX, petNotesProblem) });

  const planOk = kind === null || kind === 'pre_listing';
  const plan = planOk ? compact({
    builder: note(pl.builder, PLAN_MAX.builder, textProblem), name: note(pl.name, PLAN_MAX.name, textProblem),
    community: note(pl.community, PLAN_MAX.community, textProblem),
  }) : {};

  return compact({ yard: Object.keys(yard).length ? yard : undefined, toy: Object.keys(toy).length ? toy : undefined,
    pets: Object.keys(pets).length ? pets : undefined, plan: Object.keys(plan).length ? plan : undefined });
}
class FactsError extends Error {}

// The owner's form -> what gets stored. { data } (possibly {}) or { error } (a message for the owner).
export function validateHomeFacts(input, { kind, isRental = false } = {}) {
  try {
    return { data: shapeFacts(input, { kind: kind || '', isRental: !!isRental, checkText: true }) };
  } catch (e) {
    if (e instanceof FactsError) return { error: e.message };
    throw e;
  }
}

// A stored row -> facts. Never throws: bad JSON is {}, bad values are dropped (text was checked when it was saved).
export function homeFactsFromRow(row) {
  let raw = {};
  try { raw = JSON.parse((row && row.home_facts_json) || '{}') || {}; } catch { raw = {}; }
  try { return shapeFacts(raw, { kind: null, checkText: false }); } catch { return {}; }
}

export function hasHomeFacts(facts) {
  return !!facts && ['yard', 'toy', 'pets', 'plan'].some(g => isObj(facts[g]) && Object.keys(facts[g]).length > 0);
}

const HOA_RULE_LABELS = { allowed: 'allowed', limited: 'limited (see HOA rules)' };

// Plain-text lines for each block (escaped by the caller), printed joined with ' · ' under the headings above.
// Nothing is computed: every number printed is one the owner typed. When the pets block has any line, its LAST line
// is always the assistance-animal note; no renderer may drop it.
export function homeFactsLines(facts, costs, { isRental = false, longNote = false } = {}) {
  const f = isObj(facts) ? facts : {};
  const y = isObj(f.yard) ? f.yard : {}, t = isObj(f.toy) ? f.toy : {}, p = isObj(f.pets) ? f.pets : {};
  const hoa = costs && isObj(costs.hoaDetails) ? costs.hoaDetails : {};
  const labels = (map, list) => (Array.isArray(list) ? list.map(k => map[k]).filter(Boolean) : []);

  const yard = [];
  if (DIRECTIONS[y.faces]) yard.push(`Backyard faces ${DIRECTIONS[y.faces]}`);
  if (DIRECTIONS[y.frontFaces]) yard.push(`Front faces ${DIRECTIONS[y.frontFaces]}`);
  const outdoor = labels(OUTDOOR, y.outdoor);
  if (outdoor.length) yard.push(`Outdoor space: ${outdoor.join(', ')}`);
  if (YARD_SIZES[y.size]) yard.push(`Yard size: ${YARD_SIZES[y.size]}`);
  if (FENCED[y.fenced]) yard.push(`Fenced: ${FENCED[y.fenced]}`);
  if (AFTERNOON_SUN[y.afternoonSun]) yard.push(`Afternoon in the backyard: ${AFTERNOON_SUN[y.afternoonSun]}`);
  const shade = labels(SHADE, y.shade);
  if (shade.length) yard.push(`Shade: ${shade.join(', ')}`);
  if (SOLAR[y.solar]) yard.push(`Solar panels: ${SOLAR[y.solar]}`);
  if (y.notes) yard.push(`Owner's notes: ${y.notes}`);

  const toy = [];
  if (t.rv === 'yes') toy.push(`RV or boat parking: yes${RV_SPOTS[t.rvSpot] ? ` (${RV_SPOTS[t.rvSpot]})` : ''}`);
  else if (t.rv === 'no') toy.push('RV or boat parking: no');
  if (YES_NO[t.sideAccess]) toy.push(`Side or back yard vehicle access: ${t.sideAccess}`);
  if (Number.isInteger(t.gateIn)) toy.push(`Gate opening about ${t.gateIn} in. (owner measured)`);
  if (Number.isInteger(t.drivewayFt)) toy.push(`Driveway about ${t.drivewayFt} ft long (owner measured)`);
  if (t.garage === 0) toy.push('Garage: none');
  else if (Number.isInteger(t.garage)) toy.push(`Garage: ${t.garage} space${t.garage === 1 ? '' : 's'}${t.tandem === 'yes' ? ', tandem' : ''}`);
  if (YES_NO[t.workshop]) toy.push(`Workshop space: ${t.workshop}`);
  if (YES_NO[t.ev240]) toy.push(`240V or EV outlet at the parking: ${t.ev240}`);
  if (HOA_RULE_LABELS[hoa.parking]) toy.push(`HOA RV/boat parking: ${HOA_RULE_LABELS[hoa.parking]}`);

  const pets = [];
  if (HOA_RULE_LABELS[hoa.pets]) pets.push(`HOA pets: ${HOA_RULE_LABELS[hoa.pets]}`);
  if (isRental && RENTAL_PETS[p.rental]) pets.push(`Renters: ${RENTAL_PETS[p.rental]}`);
  if (p.notes) pets.push(`Owner's pet notes: ${p.notes}`);
  if (pets.length) pets.push(longNote ? ASSISTANCE_ANIMAL_LINE_LONG : ASSISTANCE_ANIMAL_LINE);

  return { yard, toy, pets };
}

// The home's AREA for the drive link: "Neighborhood, City, ST 91914" (zip only when the row has one; listings have no
// zip column). NEVER the street address, on any view, including the owner's own.
export function driveArea(row) {
  const r = row || {};
  const s = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  const neighborhood = s(r.neighborhood), city = s(r.city);
  const place = neighborhood && neighborhood.toLowerCase() !== city.toLowerCase() ? [neighborhood, city] : [city];
  return [...place, [s(r.state), s(r.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// A key-free Google Maps directions link to the area; Google works out the drive time, Amico Haus never does.
export function planDriveHref(area, origin = '') {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(area)}&travelmode=driving` + (origin ? `&origin=${encodeURIComponent(origin)}` : '');
}
