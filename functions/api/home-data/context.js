import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { HOME_DATA_KINDS } from '../../_lib/homeData.js';
import { SDGE_ZIP_USAGE } from '../../_lib/sdgeZipUsage.js';
import { toolLive } from '../../_lib/nuancedGate.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
// A bill is summarized only when this many different owners entered it (fewer could point at one home).
const MIN_OWNERS = 5;
const BILL_KEYS = ['electric', 'gas', 'water', 'trashSewer'];
const round10 = n => Math.round(n / 10) * 10;

// What the utility published and what other owners entered, for a home's ZIP code (gate areaContext; signed-in only).
// GET /api/home-data/context?kind=listing|pre_listing&id=. A listing answers any signed-in member while it's active;
// a pre-listing answers its owner only. utility: SDG&E's published residential average for the ZIP in kWh and therms
// (never dollars: turning usage into dollars would be the site estimating a bill). members: per bill, what 5 or more
// other owners of similar-size homes in the ZIP entered, as a range and a middle. Neither is checked by Amico Haus or
// a prediction for this home, and the page says so. 2 statements + the session.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'areaContext', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const url = new URL(context.request.url);
  const kind = url.searchParams.get('kind') || '';
  const id = Number(url.searchParams.get('id'));
  const table = Object.hasOwn(HOME_DATA_KINDS, kind) ? HOME_DATA_KINDS[kind] : null;
  if (!table) return notFound('Unknown kind of home.');
  if (!Number.isInteger(id) || id <= 0) return notFound('Home not found.');

  const db = context.env.DB;
  const home = await db.prepare(`SELECT user_id, zip, sqft, status FROM ${table} WHERE id = ?`).bind(id).first();
  if (!home) return notFound('Home not found.');
  const mine = home.user_id === user.id;
  if (kind === 'pre_listing' && !mine) return forbidden();
  if (kind === 'listing' && home.status !== 'active' && !mine && user.role !== 'admin') return notFound('Home not found.');

  const zip = /^\d{5}$/.test(String(home.zip || '')) ? home.zip : '';
  if (!zip) return json({ zip: '', sqftBand: '', utility: null, members: null }, NO_STORE);

  const usage = Object.hasOwn(SDGE_ZIP_USAGE.zips, zip) ? SDGE_ZIP_USAGE.zips[zip] : null;
  const utility = Array.isArray(usage) && SDGE_ZIP_USAGE.period
    ? { period: SDGE_ZIP_USAGE.period, kwhPerMonth: usage[0], thermsPerMonth: usage[1] } : null;

  // Homes within 25% of this home's size, in the same ZIP, whose owners entered bills. No size -> no comparison.
  const sqft = Number(home.sqft) || 0;
  let members = null, sqftBand = '';
  if (sqft > 0) {
    const lo = Math.round(sqft * 0.75), hi = Math.round(sqft * 1.25);
    sqftBand = `${lo.toLocaleString('en-US')}–${hi.toLocaleString('en-US')} sqft`;
    const bills = alias => BILL_KEYS.map(k => `json_extract(${alias}.run_costs_json, '$.bills.${k}') AS ${k}`).join(', ');
    const { results } = await db.prepare(
      `SELECT l.user_id AS user_id, ${bills('l')}
         FROM listings l JOIN users u ON u.id = l.user_id
        WHERE l.zip = ?1 AND l.status = 'active' AND l.is_buyer_only = 0 AND l.is_portfolio = 0 AND l.sqft BETWEEN ?2 AND ?3
          AND u.status = 'active' AND u.email NOT LIKE ?4 AND NOT (?5 = 'listing' AND l.id = ?6)
          AND json_extract(l.run_costs_json, '$.bills') IS NOT NULL
       UNION ALL
       SELECT p.user_id AS user_id, ${bills('p')}
         FROM pre_listings p JOIN users u ON u.id = p.user_id
        WHERE p.zip = ?1 AND p.status = 'open' AND p.sqft BETWEEN ?2 AND ?3
          AND u.status = 'active' AND u.email NOT LIKE ?4 AND NOT (?5 = 'pre_listing' AND p.id = ?6)
          AND json_extract(p.run_costs_json, '$.bills') IS NOT NULL
       LIMIT 200`
    ).bind(zip, lo, hi, DEMO_EMAIL_PATTERN, kind, id).all();

    const out = {};
    for (const k of BILL_KEYS) {
      // One entry per owner (their first home here), so two homes of one owner never count twice.
      const byOwner = new Map();
      for (const r of results) {
        if (Number.isInteger(r[k]) && r[k] >= 0 && !byOwner.has(r.user_id)) byOwner.set(r.user_id, r[k]);
      }
      if (byOwner.size < MIN_OWNERS) continue;
      const v = [...byOwner.values()].sort((a, b) => a - b);
      const mid = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      out[k] = { homes: v.length, low: round10(v[0]), mid: round10(mid), high: round10(v[v.length - 1]) };
    }
    if (Object.keys(out).length) members = out;
  }
  return json({ zip, sqftBand, utility, members }, NO_STORE);
}
