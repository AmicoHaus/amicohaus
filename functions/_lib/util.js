// Seeded demo accounts (functions/api/admin/seed.js) all use this email
// pattern so they're trivially identifiable and excludable — real users
// should never see a demo account's listing, match, post, or group
// membership, since a demo account has no password and can never reply.
export const DEMO_EMAIL_PATTERN = '%@demo.amicohaus.local';

// Same formula as the public trade-for-lease calculator (calculator.html /
// page-calculator.js) — kept in sync manually since one runs client-side as a
// static script and the other server-side as a Function; there's no shared
// module boundary between the two.
export const RENTAL_SELLING_COST_PCT = 0.07;
// A lump-sum prepayment of years of rent is worth more to a landlord than the
// same total collected month by month — no vacancy risk, no collections
// risk, cash in hand today — so the tenant's real negotiating range runs from
// the exact math up to an extra 15% of time in exchange for paying it all
// upfront. This is a suggested starting point for negotiation, not a promise.
export const RENTAL_LUMP_SUM_BONUS_PCT = 0.15;

export function netSaleProceeds(estimatedValue, sellingCostPct = RENTAL_SELLING_COST_PCT) {
  return Math.max(0, Number(estimatedValue) || 0) * (1 - sellingCostPct);
}

// Returns null if there's no rent to divide by (avoids a division by zero
// reading as an infinite or NaN "years").
export function lumpSumRentalYears(netProceeds, monthlyRent) {
  const rent = Number(monthlyRent) || 0;
  if (rent <= 0) return null;
  const yearsLow = netProceeds / (rent * 12);
  const yearsHigh = yearsLow * (1 + RENTAL_LUMP_SUM_BONUS_PCT);
  return { yearsLow, yearsHigh };
}

export const PRICE_TIERS = [
  { key: 'under-300k', label: 'Under $300k', max: 300000 },
  { key: '300k-600k', label: '$300k–$600k', max: 600000 },
  { key: '600k-1m', label: '$600k–$1M', max: 1000000 },
  { key: '1m-2m', label: '$1M–$2M', max: 2000000 },
  { key: '2m-5m', label: '$2M–$5M', max: 5000000 },
  { key: '5m-plus', label: '$5M+', max: Infinity },
];

export function priceTierFor(value) {
  const v = Number(value) || 0;
  const tier = PRICE_TIERS.find(t => v <= t.max);
  return tier ? tier.key : PRICE_TIERS[PRICE_TIERS.length - 1].key;
}

export function priceTierLabel(key) {
  const tier = PRICE_TIERS.find(t => t.key === key);
  return tier ? tier.label : key;
}

export function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init && init.headers) },
  });
}

export function badRequest(message) {
  return json({ error: message }, { status: 400 });
}

export function unauthorized(message) {
  return json({ error: message || 'Not signed in.' }, { status: 401 });
}

export function forbidden(message) {
  return json({ error: message || 'Not allowed.' }, { status: 403 });
}

export function notFound(message) {
  return json({ error: message || 'Not found.' }, { status: 404 });
}

// Every other endpoint returns JSON and escapes client-side (see client.js's
// escapeHtml). Server-rendered listing pages (functions/listing/[id].js) are
// the one exception — real HTML built from user-controlled fields, so it
// needs its own escaping here.
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clampString(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function parseJsonSafe(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
