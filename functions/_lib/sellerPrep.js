// Seller prep tools on a pre-listing: what agents would fix before listing, the "get listing-ready" checklist,
// broker preview windows, and interviewing the top agents. Fixed item lists live here (not in the database), so
// rewording an item never needs a migration; main.js keeps matching copies of the labels.
import { clampString } from './util.js';

// "Before listing, I'd…" — the prep an agent recommends, saved with their sealed price opinion.
export const PREP_ITEMS = {
  paint_inside: 'Fresh paint inside',
  paint_outside: 'Touch up the outside paint',
  curb_appeal: 'Curb appeal (landscaping, front door)',
  declutter: 'Declutter and depersonalize',
  staging: 'Professional staging',
  deep_clean: 'Deep clean (carpets, windows)',
  small_repairs: 'Small repairs (leaks, doors, fixtures)',
  flooring: 'Update worn flooring',
  lighting: 'Brighter lighting and fixtures',
  pre_inspection: 'A pre-listing inspection',
  termite: 'Termite inspection and report',
  roof_hvac: 'Roof or HVAC check-up',
};

export function validatePrep(raw) {
  return Array.isArray(raw) ? [...new Set(raw.filter(k => Object.hasOwn(PREP_ITEMS, k)))] : [];
}

// "Get listing-ready": the paperwork and practical bits that slow a listing down when they're missing.
export const LISTING_READY_ITEMS = {
  payoff: 'Ask your lender for a loan payoff estimate',
  hoa_docs: 'Gather HOA documents (CC&Rs, budget, recent minutes)',
  permits: 'Find permits and final sign-offs for any remodels',
  solar: 'Find solar lease or loan papers (if any)',
  warranties: 'Collect appliance, roof and system warranties',
  utilities: 'Note average utility bills',
  keys: 'Collect all keys, garage remotes and gate codes',
  repairs: 'Finish the repairs your agent recommends',
  photos: 'Schedule professional photos',
};

export function validListingReadyKeys(raw) {
  return Array.isArray(raw) ? [...new Set(raw.filter(k => Object.hasOwn(LISTING_READY_ITEMS, k)))] : [];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The target list date: today up to two years out, or cleared.
export function validTargetDate(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const s = String(raw);
  // The site serves San Diego County, so "today" is the Pacific date (the server runs on UTC).
  const pacific = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const today = pacific(new Date());
  const max = pacific(new Date(Date.now() + 730 * 86400000));
  if (!DATE_RE.test(s) || s < today || s > max) return { error: 'Pick a target list date between today and two years from now.' };
  return { value: s };
}

// A broker preview window: in the future (up to 90 days out), at most 6 hours long.
export const MAX_UPCOMING_PREVIEWS = 5;
export function validatePreviewInput(body) {
  const starts = new Date(body.startsAt);
  const ends = new Date(body.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return { error: 'Pick a start and end time.' };
  if (starts.getTime() <= Date.now()) return { error: 'The preview has to be in the future.' };
  if (starts.getTime() > Date.now() + 90 * 86400000) return { error: 'Pick a time within the next 90 days.' };
  if (ends.getTime() <= starts.getTime()) return { error: 'The end time has to be after the start time.' };
  if (ends.getTime() - starts.getTime() > 6 * 3600000) return { error: 'Keep a preview window to 6 hours or less.' };
  return { data: { startsAt: starts.toISOString(), endsAt: ends.toISOString(), note: clampString(body.note, 300) } };
}

// Interviews: the owner offers up to 3 future time slots (within 60 days) in one format.
export const INTERVIEW_FORMATS = { phone: 'Phone call', video: 'Video call', in_person: 'In person' };
export const MAX_ACTIVE_INTERVIEWS = 3;
export function validateInterviewRequest(body) {
  const format = Object.hasOwn(INTERVIEW_FORMATS, body.format) ? body.format : null;
  if (!format) return { error: 'Pick phone, video or in person.' };
  const raw = Array.isArray(body.slots) ? body.slots.filter(Boolean) : [];
  if (!raw.length || raw.length > 3) return { error: 'Offer between 1 and 3 times.' };
  const slots = [];
  for (const t of raw) {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return { error: 'One of the times is not a valid date and time.' };
    if (d.getTime() <= Date.now()) return { error: 'Every time you offer has to be in the future.' };
    if (d.getTime() > Date.now() + 60 * 86400000) return { error: 'Offer times within the next 60 days.' };
    slots.push(d.toISOString());
  }
  return { data: { format, slots: [...new Set(slots)].sort() } };
}

// The owner's private scorecard: 1-5 on each question.
export const SCORE_QUESTIONS = {
  pricing: 'Explained their price clearly',
  marketing: 'Marketing plan',
  communication: 'Communication and responsiveness',
  local: 'Knows the neighborhood',
  terms: 'Fees and terms were clear',
  fit: 'Felt like a good fit',
};
export function validateScores(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of Object.keys(SCORE_QUESTIONS)) {
      const n = Number(raw[k]);
      if (Number.isInteger(n) && n >= 1 && n <= 5) out[k] = n;
    }
  }
  return out;
}

export function parseJsonArray(json) {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function parseJsonObject(json) {
  try { const v = JSON.parse(json || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

// Broker preview windows on a pre-listing: the owner opens a time when agents can walk through; approved agents
// RSVP. The owner sees who's coming; an agent sees how many are coming and whether they are. The street address
// (which otherwise only the owner sees) goes to agents once they've RSVP'd to an upcoming window.
export async function fetchPreviews(db, preListingId, { isOwner, viewerId, address }) {
  const rows = await db.prepare(
    `SELECT id, starts_at, ends_at, note FROM pre_listing_previews
     WHERE pre_listing_id = ? AND ends_at > ? ORDER BY starts_at ASC`
  ).bind(preListingId, new Date().toISOString()).all();
  const previews = [];
  let goingToAny = false;
  for (const r of rows.results) {
    const rsvps = await db.prepare(
      `SELECT r.agent_user_id, users.display_name FROM pre_listing_preview_rsvps r JOIN users ON users.id = r.agent_user_id
       WHERE r.preview_id = ? AND users.status = 'active' ORDER BY r.created_at ASC`
    ).bind(r.id).all();
    const imGoing = rsvps.results.some(x => x.agent_user_id === viewerId);
    goingToAny = goingToAny || imGoing;
    previews.push({
      id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, note: r.note, rsvpCount: rsvps.results.length, imGoing,
      agents: isOwner ? rsvps.results.map(x => ({ agentUserId: x.agent_user_id, agentName: x.display_name })) : undefined,
    });
  }
  return { previews, address: isOwner || goingToAny ? address : undefined };
}
