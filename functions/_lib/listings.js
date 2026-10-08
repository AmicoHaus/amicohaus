import { clampString, priceTierFor } from './util.js';
import { syncGroupMemberships } from './groups.js';
import { notifySavedSearches } from './savedSearches.js';
import { validLifeEventKeys } from './lifeEvents.js';

export const PROPERTY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];

export function num(value, { min = 0, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

function sanitizeExternalLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .filter(l => l && typeof l.url === 'string' && /^https:\/\//i.test(l.url))
    .slice(0, 10)
    .map(l => ({ label: clampString(l.label, 40) || 'Link', url: clampString(l.url, 500) }));
}

// Shared by a plain trade listing's "what would make you move" side and a
// portfolio's own desired_criteria (functions/_lib/portfolios.js) — the same
// rules apply to both, so this is the one place they're written.
export function validateDesiredCriteria(body) {
  const desiredType = body.desiredType === 'Any' || PROPERTY_TYPES.includes(body.desiredType) ? body.desiredType : null;
  const priceMin = num(body.priceMin, { min: 0, max: 500000000 });
  const priceMax = num(body.priceMax, { min: 0, max: 500000000 });
  const minBeds = num(body.minBeds, { min: 0, max: 50 });
  const minBaths = num(body.minBaths, { min: 0, max: 50 });
  const locations = clampString(body.locations, 200);

  if (!desiredType || priceMin === null || priceMax === null || minBeds === null || minBaths === null || !locations) {
    return { error: 'Fill in what would make you move: locations, type, price range, and minimum beds/baths.' };
  }
  if (priceMax < priceMin) return { error: 'Max price must be greater than min price.' };

  const cashMode = ['none', 'pay', 'receive'].includes(body.cashMode) ? body.cashMode : 'none';
  const cashAmount = cashMode === 'none' ? 0 : (num(body.cashAmount, { min: 0, max: 500000000 }) || 0);

  return {
    data: {
      locations, desiredType, priceMin, priceMax, minBeds, minBaths,
      mustHaves: clampString(body.mustHaves, 200), cashMode, cashAmount,
    },
  };
}

// Shared by the single-listing form (api/listings/index.js) and the broker
// bulk-upload endpoint (api/listings/bulk.js) — one place for the validation
// rules so the two paths can't silently drift apart.
export function validateListingInput(body) {
  const isBuyerOnly = !!body.isBuyerOnly;
  const isRental = !isBuyerOnly && !!body.isRental;

  // A rental listing is a real property (has its own city/state/beds/etc,
  // same as a trade listing) but isn't looking for anything back — no
  // desired_criteria row is ever created for one, so it never enters the
  // trade/buyer matching graph in matching.js.
  if (isRental) {
    const city = clampString(body.city, 80);
    const state = clampString(body.state, 20);
    const propertyType = PROPERTY_TYPES.includes(body.propertyType) ? body.propertyType : null;
    const estimatedValue = num(body.estimatedValue, { min: 0, max: 500000000 });
    const beds = num(body.beds, { min: 0, max: 50 });
    const baths = num(body.baths, { min: 0, max: 50 });
    const rentAmount = num(body.rentAmount, { min: 1, max: 2000000 });
    const minLeaseMonths = body.minLeaseMonths ? num(body.minLeaseMonths, { min: 1, max: 360 }) : 12;

    if (!city || !state || !propertyType || estimatedValue === null || beds === null || baths === null) {
      return { error: 'Fill in city, state, property type, value, beds, and baths.' };
    }
    if (rentAmount === null) return { error: 'Enter a monthly rent amount.' };

    return {
      data: {
        isRental: true, isBuyerOnly: false,
        title: clampString(body.title, 120),
        description: clampString(body.description, 2000),
        address: clampString(body.address, 150),
        neighborhood: clampString(body.neighborhood, 80),
        clientName: clampString(body.clientName, 100),
        city, state, propertyType, beds, baths,
        sqft: body.sqft ? num(body.sqft, { min: 0, max: 200000 }) : null,
        estimatedValue,
        showExactAddress: !!body.showExactAddress,
        externalLinks: sanitizeExternalLinks(body.externalLinks),
        rentAmount, minLeaseMonths,
        // No "what would make you move" side for a rental — these fields
        // exist only so insertListing()'s shared bind signature stays simple;
        // insertListing skips the desired_criteria insert entirely for rentals.
        locations: '', desiredType: null, priceMin: 0, priceMax: 0, minBeds: 0, minBaths: 0,
        mustHaves: '', cashMode: 'none', cashAmount: 0,
        lifeEventTags: validLifeEventKeys(body.lifeEventTags),
      },
    };
  }

  const desiredValidated = validateDesiredCriteria(body);
  if (desiredValidated.error) return { error: desiredValidated.error };
  const { locations, desiredType, priceMin, priceMax, minBeds, minBaths } = desiredValidated.data;

  // A first-time/primary buyer has no home to describe — they only need the
  // "what I'm looking for" side. Everything below is derived from that so the
  // listings table's NOT NULL home fields still have sensible values, even
  // though a buyer-only listing is never shown as a "home" anywhere.
  if (isBuyerOnly) {
    return {
      data: {
        isBuyerOnly: true, isRental: false,
        title: clampString(body.title, 120) || 'First-time Buyer Profile',
        description: clampString(body.description, 2000),
        address: '', neighborhood: '', clientName: clampString(body.clientName, 100),
        city: locations.split(',')[0].trim().slice(0, 80) || 'Any',
        state: '',
        propertyType: desiredType === 'Any' ? PROPERTY_TYPES[0] : desiredType,
        beds: minBeds, baths: minBaths, sqft: null,
        estimatedValue: priceMax || priceMin || 0,
        showExactAddress: false,
        externalLinks: [],
        locations, desiredType, priceMin, priceMax, minBeds, minBaths,
        mustHaves: clampString(body.mustHaves, 200),
        cashMode: 'pay', cashAmount: priceMax || priceMin || 0,
        lifeEventTags: validLifeEventKeys(body.lifeEventTags),
      },
    };
  }

  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  const propertyType = PROPERTY_TYPES.includes(body.propertyType) ? body.propertyType : null;
  const estimatedValue = num(body.estimatedValue, { min: 0, max: 500000000 });
  const beds = num(body.beds, { min: 0, max: 50 });
  const baths = num(body.baths, { min: 0, max: 50 });

  if (!city || !state || !propertyType || estimatedValue === null || beds === null || baths === null) {
    return { error: 'Fill in city, state, property type, value, beds, and baths.' };
  }

  return {
    data: {
      isBuyerOnly: false, isRental: false,
      title: clampString(body.title, 120),
      description: clampString(body.description, 2000),
      address: clampString(body.address, 150),
      neighborhood: clampString(body.neighborhood, 80),
      clientName: clampString(body.clientName, 100),
      city, state, propertyType, beds, baths,
      sqft: body.sqft ? num(body.sqft, { min: 0, max: 200000 }) : null,
      estimatedValue,
      showExactAddress: !!body.showExactAddress,
      externalLinks: sanitizeExternalLinks(body.externalLinks),
      locations, desiredType, priceMin, priceMax, minBeds, minBaths,
      mustHaves: desiredValidated.data.mustHaves,
      cashMode: desiredValidated.data.cashMode, cashAmount: desiredValidated.data.cashAmount,
      lifeEventTags: validLifeEventKeys(body.lifeEventTags),
    },
  };
}

// The listing's kind (trade / buyer-only / rental) is fixed at creation and
// can't change via edit — only the data within that kind can be updated. This
// deliberately reuses validateListingInput's per-kind rules wholesale rather
// than re-deriving them, so the two paths can never drift apart.
export function validateListingEdit(existingIsBuyerOnly, existingIsRental, body) {
  return validateListingInput({ ...body, isBuyerOnly: existingIsBuyerOnly, isRental: existingIsRental });
}

export async function updateListing(db, id, userId, d) {
  const priceTier = priceTierFor(d.estimatedValue);

  await db.prepare(
    `UPDATE listings SET title = ?, description = ?, address = ?, neighborhood = ?, client_name = ?,
       city = ?, state = ?, property_type = ?, beds = ?, baths = ?, sqft = ?, estimated_value = ?,
       price_tier = ?, show_exact_address = ?, external_links = ?, rent_amount = ?, min_lease_months = ?,
       life_event_tags_json = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    d.title, d.description, d.address, d.neighborhood, d.clientName || null,
    d.city, d.state, d.propertyType, d.beds, d.baths, d.sqft, d.estimatedValue, priceTier,
    d.showExactAddress ? 1 : 0, JSON.stringify(d.externalLinks), d.rentAmount || 0, d.minLeaseMonths || 12,
    JSON.stringify(d.lifeEventTags || []), id
  ).run();

  // A rental has no desired_criteria row. Every other kind does — upsert
  // rather than assume it exists, since a listing's row could in principle
  // predate a schema change that added this table (belt-and-suspenders, not
  // an expected case in practice).
  if (!d.isRental) {
    const existing = await db.prepare('SELECT 1 FROM desired_criteria WHERE listing_id = ?').bind(id).first();
    if (existing) {
      await db.prepare(
        `UPDATE desired_criteria SET locations = ?, property_type = ?, min_beds = ?, min_baths = ?,
           price_min = ?, price_max = ?, must_haves = ?, cash_mode = ?, cash_amount = ? WHERE listing_id = ?`
      ).bind(d.locations, d.desiredType, d.minBeds, d.minBaths, d.priceMin, d.priceMax, d.mustHaves, d.cashMode, d.cashAmount, id).run();
    } else {
      await db.prepare(
        `INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max, must_haves, cash_mode, cash_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, d.locations, d.desiredType, d.minBeds, d.minBaths, d.priceMin, d.priceMax, d.mustHaves, d.cashMode, d.cashAmount).run();
    }
  }

  await syncGroupMemberships(db, userId, { city: d.city, state: d.state, estimatedValue: d.estimatedValue });
}

export async function insertListing(db, userId, d) {
  const priceTier = priceTierFor(d.estimatedValue);

  const result = await db.prepare(
    `INSERT INTO listings (user_id, title, description, address, neighborhood, client_name, city, state, property_type,
       beds, baths, sqft, estimated_value, price_tier, show_exact_address, external_links, is_buyer_only,
       is_rental, rent_amount, min_lease_months, life_event_tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, d.title, d.description, d.address, d.neighborhood, d.clientName || null,
    d.city, d.state, d.propertyType, d.beds, d.baths, d.sqft, d.estimatedValue, priceTier,
    d.showExactAddress ? 1 : 0, JSON.stringify(d.externalLinks), d.isBuyerOnly ? 1 : 0,
    d.isRental ? 1 : 0, d.rentAmount || 0, d.minLeaseMonths || 12, JSON.stringify(d.lifeEventTags || [])
  ).run();

  const listingId = result.meta.last_row_id;

  // A rental has no "what would make you move" side — it's a straight
  // supply-side listing, so no desired_criteria row is created at all. That
  // also means it never enters the trade/buyer matching graph, which relies
  // on every candidate having a desired_criteria row.
  if (!d.isRental) {
    await db.prepare(
      `INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max, must_haves, cash_mode, cash_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(listingId, d.locations, d.desiredType, d.minBeds, d.minBaths, d.priceMin, d.priceMax, d.mustHaves, d.cashMode, d.cashAmount).run();
  }

  await syncGroupMemberships(db, userId, { city: d.city, state: d.state, estimatedValue: d.estimatedValue });
  // A buyer-only profile has no home, and a rental isn't itself a match for
  // anyone's "I want to trade for a home" saved search — skip the "new
  // listing matches your saved search" notification for both.
  if (!d.isBuyerOnly && !d.isRental) {
    await notifySavedSearches(db, { user_id: userId, city: d.city, state: d.state, property_type: d.propertyType, estimated_value: d.estimatedValue });
  }

  return listingId;
}
