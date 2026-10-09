// Structured offers on a GreenHomes listing. Mirrors functions/_lib/listingOffers.js exactly (including the
// multi-round counter support via countered_by), just against green_home_offers/green_home_id.
import { clampString } from './util.js';

function num(value, { min = 0, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

export function validateOfferInput(body) {
  const offerPrice = num(body.offerPrice, { min: 1, max: 500000000 });
  if (offerPrice === null) return { error: 'Enter an offer price.' };
  const financingType = ['cash', 'financed'].includes(body.financingType) ? body.financingType : 'financed';
  return {
    data: {
      offerPrice, financingType,
      closingTimeline: clampString(body.closingTimeline, 100),
      contingencies: clampString(body.contingencies, 500),
      message: clampString(body.message, 1000),
    },
  };
}

export async function insertOffer(db, homeId, buyerUserId, d) {
  const result = await db.prepare(
    `INSERT INTO green_home_offers (green_home_id, buyer_user_id, offer_price, financing_type, closing_timeline, contingencies, message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(homeId, buyerUserId, d.offerPrice, d.financingType, d.closingTimeline, d.contingencies, d.message).run();
  return result.meta.last_row_id;
}

export async function fetchOffersForOwner(db, homeId) {
  const rows = await db.prepare(
    `SELECT green_home_offers.*, users.display_name AS buyer_name
     FROM green_home_offers JOIN users ON users.id = green_home_offers.buyer_user_id
     WHERE green_home_offers.green_home_id = ? ORDER BY green_home_offers.created_at DESC`
  ).bind(homeId).all();
  return rows.results.map(mapOfferRow);
}

export async function fetchMyOffer(db, homeId, buyerUserId) {
  const row = await db.prepare(
    `SELECT * FROM green_home_offers WHERE green_home_id = ? AND buyer_user_id = ?
     ORDER BY CASE WHEN status IN ('pending', 'countered') THEN 0 ELSE 1 END, created_at DESC LIMIT 1`
  ).bind(homeId, buyerUserId).first();
  return row ? mapOfferRow(row) : null;
}

function mapOfferRow(r) {
  return {
    id: r.id, homeId: r.green_home_id, buyerUserId: r.buyer_user_id, buyerName: r.buyer_name,
    offerPrice: r.offer_price, financingType: r.financing_type, closingTimeline: r.closing_timeline,
    contingencies: r.contingencies, message: r.message, status: r.status,
    counterPrice: r.counter_price, counterMessage: r.counter_message, counteredBy: r.countered_by, createdAt: r.created_at,
  };
}

export async function decideOffer(db, offerId, status) {
  await db.prepare("UPDATE green_home_offers SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, offerId).run();
}

export function validateCounterInput(body) {
  const counterPrice = num(body.counterPrice, { min: 1, max: 500000000 });
  if (counterPrice === null) return { error: 'Enter a counter-offer price.' };
  return { data: { counterPrice, counterMessage: clampString(body.counterMessage, 1000) } };
}

export async function counterOffer(db, offerId, d) {
  await db.prepare("UPDATE green_home_offers SET status = 'countered', counter_price = ?, counter_message = ?, countered_by = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(d.counterPrice, d.counterMessage, d.counteredBy, offerId).run();
}

export async function acceptCounter(db, offerId, counterPrice) {
  await db.prepare("UPDATE green_home_offers SET status = 'accepted', offer_price = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(counterPrice, offerId).run();
}
