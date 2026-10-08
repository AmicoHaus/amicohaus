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

export async function insertOffer(db, listingId, buyerUserId, d) {
  const result = await db.prepare(
    `INSERT INTO listing_offers (listing_id, buyer_user_id, offer_price, financing_type, closing_timeline, contingencies, message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(listingId, buyerUserId, d.offerPrice, d.financingType, d.closingTimeline, d.contingencies, d.message).run();
  return result.meta.last_row_id;
}

// The owner sees every offer on their listing; a buyer sees only their own (not competitors' numbers) --
// same visibility rule the pre-listing proposal marketplace already uses for bids.
export async function fetchOffersForOwner(db, listingId) {
  const rows = await db.prepare(
    `SELECT listing_offers.*, users.display_name AS buyer_name
     FROM listing_offers JOIN users ON users.id = listing_offers.buyer_user_id
     WHERE listing_offers.listing_id = ? ORDER BY listing_offers.created_at DESC`
  ).bind(listingId).all();
  return rows.results.map(mapOfferRow);
}

export async function fetchMyOffer(db, listingId, buyerUserId) {
  const row = await db.prepare('SELECT * FROM listing_offers WHERE listing_id = ? AND buyer_user_id = ?').bind(listingId, buyerUserId).first();
  return row ? mapOfferRow(row) : null;
}

function mapOfferRow(r) {
  return {
    id: r.id, listingId: r.listing_id, buyerUserId: r.buyer_user_id, buyerName: r.buyer_name,
    offerPrice: r.offer_price, financingType: r.financing_type, closingTimeline: r.closing_timeline,
    contingencies: r.contingencies, message: r.message, status: r.status,
    counterPrice: r.counter_price, counterMessage: r.counter_message, createdAt: r.created_at,
  };
}

export async function decideOffer(db, offerId, status) {
  await db.prepare("UPDATE listing_offers SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, offerId).run();
}

export function validateCounterInput(body) {
  const counterPrice = num(body.counterPrice, { min: 1, max: 500000000 });
  if (counterPrice === null) return { error: 'Enter a counter-offer price.' };
  return { data: { counterPrice, counterMessage: clampString(body.counterMessage, 1000) } };
}

// The owner proposes a different price; the buyer then accepts (offer_price becomes the counter_price) or
// declines it, same one-round negotiation a quick back-and-forth call would have -- not unlimited rounds.
export async function counterOffer(db, offerId, d) {
  await db.prepare("UPDATE listing_offers SET status = 'countered', counter_price = ?, counter_message = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(d.counterPrice, d.counterMessage, offerId).run();
}

export async function acceptCounter(db, offerId, counterPrice) {
  await db.prepare("UPDATE listing_offers SET status = 'accepted', offer_price = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(counterPrice, offerId).run();
}
