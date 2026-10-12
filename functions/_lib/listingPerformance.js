// Owner-facing performance export: every real event on one listing/home -- offers, price changes, favorites
// and deal-thread comments -- merged into one chronological timeline. Same idea as the Market Pulse history
// download, just scoped to a single entity the caller already owns, for "how has MY listing actually done".
const CONFIG = {
  listing: {
    offersTable: 'listing_offers', offersFk: 'listing_id',
    favoritesTable: 'listing_feedback', favoritesFk: 'listing_id', favoritesWhere: "AND feedback = 'up'",
    priceHistoryTable: null, threadColumn: 'listing_id',
  },
  augmented_home: {
    offersTable: 'augmented_home_offers', offersFk: 'augmented_home_id',
    favoritesTable: 'augmented_home_favorites', favoritesFk: 'augmented_home_id', favoritesWhere: '',
    priceHistoryTable: 'augmented_home_price_history', priceHistoryFk: 'augmented_home_id', threadColumn: 'augmented_home_id',
  },
  green_home: {
    offersTable: 'green_home_offers', offersFk: 'green_home_id',
    favoritesTable: 'green_home_favorites', favoritesFk: 'green_home_id', favoritesWhere: '',
    priceHistoryTable: 'green_home_price_history', priceHistoryFk: 'green_home_id', threadColumn: 'green_home_id',
  },
};

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

export async function fetchListingPerformanceEvents(db, kind, entityId) {
  const c = CONFIG[kind];
  if (!c) return [];
  const events = [];

  const offers = await db.prepare(
    `SELECT ${c.offersTable}.created_at, ${c.offersTable}.offer_price, ${c.offersTable}.status, users.display_name AS buyer_name
     FROM ${c.offersTable} JOIN users ON users.id = ${c.offersTable}.buyer_user_id
     WHERE ${c.offersTable}.${c.offersFk} = ?`
  ).bind(entityId).all();
  for (const r of offers.results) {
    events.push({ date: r.created_at, type: 'offer', detail: `${r.status} — ${money(r.offer_price)} from ${r.buyer_name}` });
  }

  const favorites = await db.prepare(
    `SELECT created_at FROM ${c.favoritesTable} WHERE ${c.favoritesFk} = ? ${c.favoritesWhere}`
  ).bind(entityId).all();
  for (const r of favorites.results) events.push({ date: r.created_at, type: 'favorite', detail: 'Saved by a visitor' });

  if (c.priceHistoryTable) {
    const prices = await db.prepare(
      `SELECT changed_at, old_price, new_price FROM ${c.priceHistoryTable} WHERE ${c.priceHistoryFk} = ? ORDER BY changed_at ASC`
    ).bind(entityId).all();
    for (const r of prices.results) events.push({ date: r.changed_at, type: 'price_change', detail: `${money(r.old_price)} → ${money(r.new_price)}` });
  } else {
    // Regular listings have no dedicated price-history table -- market_events is the real-event log instead.
    const mkt = await db.prepare(
      `SELECT created_at, event_type, headline FROM market_events
       WHERE entity_kind = 'listing' AND entity_id = ? AND event_type IN ('new_listing','price_drop') ORDER BY created_at ASC`
    ).bind(entityId).all();
    for (const r of mkt.results) events.push({ date: r.created_at, type: r.event_type, detail: r.headline });
  }

  const comments = await db.prepare(
    `SELECT comments.created_at, users.display_name AS author_name FROM posts
     JOIN comments ON comments.post_id = posts.id
     JOIN users ON users.id = comments.user_id
     WHERE posts.${c.threadColumn} = ?`
  ).bind(entityId).all();
  for (const r of comments.results) events.push({ date: r.created_at, type: 'comment', detail: `Comment from ${r.author_name}` });

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}
