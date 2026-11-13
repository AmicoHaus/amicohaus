// Terms Wishlist, Owner Will Carry and the Sell and Stay badge (nuanced ideas batch, migration_v47): the seller's
// ranked non-price terms (fixed keys, never free text) and two yes/no financing flags as the owner states them, on a
// trade listing or a pre-listing. No rate, amount, term or payment is stored anywhere. Pure (no DB).
// listing-terms.js (the app) carries the same strings: keep the two in sync by hand (tools/listing-terms-test.mjs).
import { escapeHtml } from './util.js';

// Home and sale terms only. Nothing about the buyer, their financing type, family, job, letter or story.
export const WISHLIST_ITEMS = {
  quick_close: 'A quick closing (about 30 days or less)',
  flexible_close: 'A flexible closing date',
  stay_after: 'Time to stay after closing (a short rent-back)',
  as_is: 'An as-is sale',
  few_contingencies: 'Fewer contingencies',
  home_sale_ok: 'Open to a buyer who needs to sell a home first',
  items_stay: 'Leaving appliances or furniture with the home',
  simple_handoff: 'A simple handoff (keys, manuals and warranties ready)',
};
export const WISHLIST_MAX = 5;
export const WISHLIST_HEADING = 'What matters to this seller besides price (from the owner)';
export const WISHLIST_LINE = "A wish list, not a requirement or an offer. It's about the sale, never about the buyer. Terms are agreed in writing, with your agents.";
export const WISHLIST_BUYER_LINE = 'Inspections and contingencies protect buyers. Talk with your agent before giving any up.';
export const LETTER_LINE = 'No personal letter needed: this seller listed the terms that matter to them.';
export const FINANCING_HEADING = 'Financing ideas (from the owner)';
export const OWNER_CARRY_LINE = "The owner says they're open to seller financing. No terms are offered here: they're between you, your agents and a licensed loan professional. Federal and state lending rules apply.";
export const ASSUMABLE_LINE = "The owner says their loan may be assumable. The loan servicer decides; ask them what applies.";
export const CREDIT_TERMS_ERROR = "Leave loan terms out of your listing (rates, down payments, payments, years). The flag only says you're open to it.";
export const SELL_STAY_NOTE = 'Your agents write the rent-back terms. No rent amounts are set on Amico Haus.';

const NO_TERMS = () => ({ termsWishlist: [], ownerCarry: 0, assumable: 0 });
const ticked = v => v === true || v === 1 || v === '1' || v === 'yes' || v === 'on';

// The known keys, in the order given (the order IS the rank), each once, at most WISHLIST_MAX.
function cleanWishlist(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    if (typeof k === 'string' && Object.hasOwn(WISHLIST_ITEMS, k) && !out.includes(k)) out.push(k);
    if (out.length >= WISHLIST_MAX) break;
  }
  return out;
}

// { data: { termsWishlist, ownerCarry, assumable } }. A rental stores nothing (and so do a buyer-only profile and a
// portfolio: their callers pass isRental or skip this). stayAfterDays is accepted for callers that have it; the wish
// list never stores a day count of its own (the stay lives in Timing Match).
export function validateListingTerms(input, { kind, isRental = false, stayAfterDays = 0 } = {}) {
  const t = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (isRental) return { data: NO_TERMS() };
  return { data: { termsWishlist: cleanWishlist(t.termsWishlist), ownerCarry: ticked(t.ownerCarry) ? 1 : 0, assumable: ticked(t.assumable) ? 1 : 0 } };
}

// The same shape, read from a listings or pre_listings row. Never throws.
export function listingTermsFromRow(row) {
  if (!row) return NO_TERMS();
  let list = [];
  try { list = JSON.parse(row.terms_wishlist_json || '[]'); } catch { list = []; }
  return { termsWishlist: cleanWishlist(list), ownerCarry: Number(row.owner_carry) === 1 ? 1 : 0, assumable: Number(row.assumable) === 1 ? 1 : 0 };
}

// Create: a tool that is dark for this person stores its defaults (live = liveTools(...), nuancedGate.js).
export function termsForCreate(terms, live) {
  const t = terms || NO_TERMS();
  const l = live || {};
  return {
    termsWishlist: l.termsWishlist ? t.termsWishlist : [],
    ownerCarry: l.ownerCarry ? t.ownerCarry : 0,
    assumable: l.ownerCarry ? t.assumable : 0,
  };
}

// Edit: only what the body sent AND the person's live tools cover is written; everything else stays as stored.
// input = the raw terms object from the body, terms = validateListingTerms(input).data.
export function termsForEdit(input, terms, live) {
  const has = k => !!input && typeof input === 'object' && Object.hasOwn(input, k);
  const l = live || {};
  const out = {};
  if (l.termsWishlist && has('termsWishlist')) out.termsWishlist = terms.termsWishlist;
  if (l.ownerCarry && (has('ownerCarry') || has('assumable'))) { out.ownerCarry = terms.ownerCarry; out.assumable = terms.assumable; }
  return out;
}

// The SET pieces and their values for a termsForEdit() result (nothing to write -> empty lists).
export function termsUpdateSql(partial) {
  const cols = [];
  const values = [];
  const p = partial || {};
  if (p.termsWishlist !== undefined) { cols.push('terms_wishlist_json = ?'); values.push(JSON.stringify(p.termsWishlist)); }
  if (p.ownerCarry !== undefined) { cols.push('owner_carry = ?', 'assumable = ?'); values.push(p.ownerCarry ? 1 : 0, p.assumable ? 1 : 0); }
  return { cols, values };
}

// Loan terms stay out of a listing that carries a financing flag (it would read as an advertisement of credit
// terms). "100% remodeled", "Selling points" and "Down the street" pass; "6.5% APR", "$50k down", "30-year note" and
// any dollars-a-month figure are refused (HOA dues have their own field).
// CREDIT_MORE_RE (review fix): any percent figure except a bare 100% ("Assumable 2.75% VA loan", "5 years at 6%"),
// "7 percent", interest only, PITI, a loan balance or payoff, a dollar figure "monthly", and "5 years at 6".
const CREDIT_MORE_RE = /(?<![\d.])(?!100\s?%)\d{1,2}(\.\d+)?\s?%|\b\d{1,2}(\.\d+)?\s?(percent|por ciento)\b|\b(interest[- ]only|piti|loan balance|payoff)\b|\bbalance (of|is|about) ?\$?\d|\$\s?\d[\d,.]*\s?(k|m)?\s?(monthly|each month)\b|\b\d+\s?-?\s?(years?|yrs?|months?|mos?) (at|@) ?\d/i;
const CREDIT_RE =/\d(\.\d+)?\s?%\s*(apr|interest|down|rate|financing)|\b(apr|interest|rate|down)\b\D{0,12}\d(\.\d+)?\s?%|\b(apr|interest rate|down payment|monthly payments?|balloon|amortiz\w+|no (credit|qualifying|bank)|\d+\s?-?\s?(year|yr)s? (note|loan|term|fixed))\b|\$\s?\d[\d,.]*\s?(k|m)?\s?(\/|per|a)\s?(mo|month)\b|\$\s?\d[\d,.]*\s?(k|m)?\s?down\b/i;
// The error message when owner text states credit terms (a rate, a payment, a down payment), or null.
export function creditTermsProblem(text) {
  const s = String(text || '');
  return CREDIT_RE.test(s) || CREDIT_MORE_RE.test(s) ? CREDIT_TERMS_ERROR : null;
}

// The wish-list labels in rank order. On a pre-listing with a stay set in Timing Match, the stay item names the days.
export function wishlistLabels(keys, { kind = 'listing', stayAfterDays = 0 } = {}) {
  const n = Math.floor(Number(stayAfterDays)) || 0;
  return cleanWishlist(keys).map(k => (k === 'stay_after' && kind === 'pre_listing' && n > 0 ? `Time to stay after closing (up to ${n} days)` : WISHLIST_ITEMS[k]));
}

// Escaped HTML blocks for a home's page. live = liveTools(...). A rental, a buyer-only profile and a portfolio get
// none. The financing line names no lender, phone number or rate, and never sits inside the "Talk to a lender" note.
export function termsBlocksHtml(row, live, { kind = 'listing' } = {}) {
  const out = { financing: '', wishlist: '', offerNote: '' };
  if (!row || row.is_rental || row.is_buyer_only || row.is_portfolio) return out;
  const l = live || {};
  const t = listingTermsFromRow(row);
  if (l.ownerCarry && (t.ownerCarry || t.assumable)) {
    const lines = [];
    if (t.ownerCarry) lines.push(OWNER_CARRY_LINE);
    if (t.assumable) lines.push(ASSUMABLE_LINE);
    out.financing = `<p class="tiny financing-flags"><span class="label">${escapeHtml(FINANCING_HEADING)}</span> ${escapeHtml(lines.join(' '))}${t.assumable ? ' <a href="/assumable-loans">About assumable loans</a>' : ''}</p>`;
  }
  if (l.termsWishlist && t.termsWishlist.length) {
    const items = wishlistLabels(t.termsWishlist, { kind, stayAfterDays: row.stay_after_days });
    out.wishlist = `<div class="card about-card terms-wishlist"><h2>${escapeHtml(WISHLIST_HEADING)}</h2><ol>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ol><p class="tiny">${escapeHtml(WISHLIST_LINE)}</p><p class="tiny">${escapeHtml(WISHLIST_BUYER_LINE)}</p></div>`;
    out.offerNote = `<p class="tiny">${escapeHtml(LETTER_LINE)}</p>`;
  }
  return out;
}

// The "Sell and stay" badge text for a pre-listing's stay_after_days, or ''.
export function sellStayBadge(days) {
  const n = Math.floor(Number(days)) || 0;
  return n > 0 ? `Seller would like to stay up to ${n} days after closing` : '';
}
