// Handoff binder (owner tools batch): the homeowner's own house manual for the next owner (sprinklers, breakers,
// paint colors, appliances, trash day, how the HOA amenities work) plus a short move-out checklist. Owner only: the
// hired agent, other agents and admins never see it in the app, there's no share link and no badge. The owner prints
// it or saves it as a PDF and hands it over; the site never sends it. Stored as pre_listings.binder_json, checked
// here (no free-form keys). Codes (gate, alarm, garage, lockbox) are refused: they're handed over in person.
// It's owner notes, never a disclosure, and nothing from proposals, price opinions, visit feedback or interviews
// goes in.
import { codeProblem, CODE_ERROR } from './homeText.js';
import { parseJsonObject } from './sellerPrep.js';

export const BINDER_NOT_DISCLOSURE = 'Owner notes, not a disclosure. Your seller disclosures (like the TDS and SPQ) are separate, and your agent handles those.';
export const BINDER_CODES_NOTE = "Hand over gate, alarm, garage and lockbox codes in person. Don't write them here.";
export const BINDER_SECTIONS = { water_yard: 'Water and yard', power_gas: 'Power and gas', paint_finishes: 'Paint and finishes',
  trash: 'Trash and recycling', hoa_amenities: 'HOA amenities', next_owner_notes: 'Notes for the next owner' };
export const MOVE_OUT_ITEMS = { mail_forwarding: 'Forward your mail with USPS', utilities: 'Set up or stop electric, gas, water and trash service (a recent bill shows who serves your home)',
  dmv_address: 'Update your address with the DMV', insurance: 'Ask your insurance agent when to end your policy',
  keys_remotes: 'Gather keys, garage remotes and manuals for closing', own_photos: 'Take your own photos of each room before you hand over the keys' };
// Plain pointers only (government and USPS pages; no referral or paid links).
export const MOVE_OUT_LINKS = { mail_forwarding: 'https://www.usps.com/manage/forward.htm', dmv_address: 'https://www.dmv.ca.gov/' };

export const BINDER_LIMITS = { section: 500, appliances: 20, item: 60, brand: 40, manual: 80, photos: 8, bytes: 16 * 1024, minYear: 1950 };

const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

// body: what the owner sent. homePhotoIds: this home's current photo ids (anything else is dropped).
// -> { data } | { error }. Unknown keys are dropped.
export function validateBinder(body, homePhotoIds) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid binder.' };
  const L = BINDER_LIMITS;
  const sectionsIn = body.sections && typeof body.sections === 'object' ? body.sections : {};
  const sections = {};
  for (const [key, label] of Object.entries(BINDER_SECTIONS)) {
    const text = str(sectionsIn[key]);
    if (text.length > L.section) return { error: `Keep "${label}" under ${L.section} characters.` };
    if (codeProblem(text)) return { error: CODE_ERROR };
    sections[key] = text;
  }

  const appliancesIn = Array.isArray(body.appliances) ? body.appliances : [];
  const appliances = [];
  const maxYear = new Date().getUTCFullYear();
  for (const a of appliancesIn) {
    if (!a || typeof a !== 'object') continue;
    const item = str(a.item), brand = str(a.brand), manual = str(a.manual);
    const yearText = str(a.year);
    if (!item && !brand && !manual && !yearText) continue; // an empty row
    if (item.length > L.item || brand.length > L.brand || manual.length > L.manual) {
      return { error: `Keep appliance names under ${L.item} characters, brands under ${L.brand} and manual notes under ${L.manual}.` };
    }
    let year = null;
    if (yearText) {
      year = Number(yearText);
      if (!Number.isInteger(year) || year < L.minYear || year > maxYear) return { error: `Pick a year between ${L.minYear} and ${maxYear}, or leave it blank.` };
    }
    if ([item, brand, manual].some(codeProblem)) return { error: CODE_ERROR };
    appliances.push({ item, brand, year, manual });
  }
  if (appliances.length > L.appliances) return { error: `List up to ${L.appliances} appliances.` };

  const allowed = new Set((homePhotoIds || []).map(Number));
  const photoIds = [...new Set((Array.isArray(body.photoIds) ? body.photoIds : []).map(Number))].filter(id => allowed.has(id));
  if (photoIds.length > L.photos) return { error: `Pick up to ${L.photos} photos.` };

  const moveOut = [...new Set((Array.isArray(body.moveOut) ? body.moveOut : []).map(String))].filter(k => Object.hasOwn(MOVE_OUT_ITEMS, k));
  const printAddress = body.printAddress !== false;

  const data = { sections, appliances, photoIds, moveOut, printAddress };
  if (JSON.stringify(data).length > L.bytes) return { error: 'The binder is too long. Shorten a few notes and try again.' };
  return { data };
}

// The stored binder with every default filled in, for the owner's form and the print page. Photo ids that are no
// longer this home's photos (deleted, or replaced by a Privacy Sweep copy with a new id) are dropped.
export function binderForOwner(row, homePhotoIds) {
  const raw = parseJsonObject(row && row.binder_json);
  const sectionsIn = raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
  const sections = {};
  for (const key of Object.keys(BINDER_SECTIONS)) sections[key] = typeof sectionsIn[key] === 'string' ? sectionsIn[key] : '';
  const appliances = (Array.isArray(raw.appliances) ? raw.appliances : []).filter(a => a && typeof a === 'object').slice(0, BINDER_LIMITS.appliances)
    .map(a => ({ item: str(a.item), brand: str(a.brand), year: Number.isInteger(a.year) ? a.year : null, manual: str(a.manual) }));
  const allowed = new Set((homePhotoIds || []).map(Number));
  const photoIds = (Array.isArray(raw.photoIds) ? raw.photoIds : []).map(Number).filter(id => allowed.has(id)).slice(0, BINDER_LIMITS.photos);
  const moveOut = (Array.isArray(raw.moveOut) ? raw.moveOut : []).filter(k => Object.hasOwn(MOVE_OUT_ITEMS, k));
  return { sections, appliances, photoIds, moveOut, printAddress: raw.printAddress !== false };
}
