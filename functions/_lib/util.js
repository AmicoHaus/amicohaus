// Seeded demo accounts (functions/api/admin/seed.js) all use this email
// pattern so they're trivially identifiable and excludable — real users
// should never see a demo account's listing, match, post, or group
// membership, since a demo account has no password and can never reply.
export const DEMO_EMAIL_PATTERN = '%@demo.amicohaus.local';

// Rough math behind rental matches (functions/_lib/matching.js): the seller's own home value, less a rough share
// for selling costs, divided by a year's rent. It's only used to decide whether a rental is worth showing as a
// match, never as advice. The site no longer adds any "extra time for paying it as a lump sum" (Rudy 11.04): a
// platform-set bonus read as a suggestion, and a large rent prepayment can be lost if the landlord sells,
// refinances or loses the home. The public calculator (calculator.html / page-calculator.js) uses the owner's own
// numbers, including their loan payoff.
export const RENTAL_SELLING_COST_PCT = 0.07;

export function netSaleProceeds(estimatedValue, sellingCostPct = RENTAL_SELLING_COST_PCT) {
  return Math.max(0, Number(estimatedValue) || 0) * (1 - sellingCostPct);
}

// Returns null if there's no rent to divide by (avoids a division by zero
// reading as an infinite or NaN "years"). yearsHigh is kept (equal to
// yearsLow) so older callers that print a range still read one number.
export function lumpSumRentalYears(netProceeds, monthlyRent) {
  const rent = Number(monthlyRent) || 0;
  if (rent <= 0) return null;
  const yearsLow = netProceeds / (rent * 12);
  return { yearsLow, yearsHigh: yearsLow };
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

// Shared CSV writer for the couple of export endpoints (Market Pulse history, a listing's own performance) --
// quotes a field only when it actually needs it (contains a comma, quote, or newline), same minimal-quoting
// convention most CSV readers (incl. Excel/Sheets) expect.
function csvField(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return [header, ...rows].map(row => row.map(csvField).join(',')).join('\n') + '\n';
}

// Every CSV here is someone's own data (or needs a sign-in), and Cloudflare caches any URL ending in .csv at the
// edge by default, so one person's download could be served to the next visitor. private + no-store stops that.
export function csvResponse(csv, filename) {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
