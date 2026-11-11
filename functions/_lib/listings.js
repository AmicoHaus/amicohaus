import { clampString, priceTierFor } from './util.js';
import { syncGroupMemberships } from './groups.js';
import { validLifeEventKeys } from './lifeEvents.js';
import { validateHomeFacts } from './homeFacts.js';
import { validateFloorPlan } from './planTwins.js';

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

// California fair housing law (Gov. Code 12955) protects a renter's source of income, including a Section 8 or VASH
// voucher, so a rental can't post limits like "no vouchers" or "Section 8 not accepted". Checked on create, edit and
// bulk upload of a rental (validateListingInput's rental branch and the plain-description edit in listings/[id].js).
export const SOURCE_OF_INCOME_LIMIT = /\b(no|not accepting|won['’]?t accept|don['’]?t accept)\s+(section\s*8|sec\.?\s*8|s8|vouchers?|housing (assistance|subsidies)|government assistance)\b|\b(section\s*8|vouchers?)\s+not\s+(accepted|allowed|welcome)\b/i;
export const SOURCE_OF_INCOME_ERROR = "Listings can't limit renters by source of income, such as housing vouchers (California law).";
export function sourceOfIncomeLimitError(...texts) { return SOURCE_OF_INCOME_LIMIT.test(texts.filter(Boolean).join(' ')) ? SOURCE_OF_INCOME_ERROR : null; }

// Home facts (yard/sun, parking and garage, pets) and the floor plan ride in the listing body itself, so a brand-new
// listing's saved-search alert (sent from the same request) already sees its parking facts. Only a real home has them:
// buyer-only profiles get none (portfolios are made in portfolios.js and keep the column defaults).
const NO_FLOOR_PLAN = { builder: null, name: null, community: null, key: null, showTwins: 0 };
function homeExtras(body, isRental) {
  const facts = validateHomeFacts(body.homeFacts || {}, { kind: 'listing', isRental });
  if (facts.error) return { error: facts.error };
  const plan = validateFloorPlan(body.floorPlan || {});
  if (plan.error) return { error: plan.error };
  return { homeFacts: facts.data, floorPlan: plan.data };
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
    const sourceOfIncomeError = sourceOfIncomeLimitError(
      clampString(body.title, 120), clampString(body.neighborhood, 80), clampString(body.description, 2000), clampString(body.mustHaves, 200));
    if (sourceOfIncomeError) return { error: sourceOfIncomeError };
    const extras = homeExtras(body, true);
    if (extras.error) return { error: extras.error };

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
        // The old "reveal exact address once matched" box is gone (it never revealed anything): a street address is
        // only ever shown to its owner and admins, so this is always off.
        showExactAddress: false,
        externalLinks: sanitizeExternalLinks(body.externalLinks),
        rentAmount, minLeaseMonths,
        // No "what would make you move" side for a rental — these fields
        // exist only so insertListing()'s shared bind signature stays simple;
        // insertListing skips the desired_criteria insert entirely for rentals.
        locations: '', desiredType: null, priceMin: 0, priceMax: 0, minBeds: 0, minBaths: 0,
        mustHaves: '', cashMode: 'none', cashAmount: 0,
        lifeEventTags: validLifeEventKeys(body.lifeEventTags),
        homeFacts: extras.homeFacts, floorPlan: extras.floorPlan,
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
        homeFacts: {}, floorPlan: { ...NO_FLOOR_PLAN },
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
  const extras = homeExtras(body, false);
  if (extras.error) return { error: extras.error };

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
      showExactAddress: false, // see the rental branch above
      externalLinks: sanitizeExternalLinks(body.externalLinks),
      locations, desiredType, priceMin, priceMax, minBeds, minBaths,
      mustHaves: desiredValidated.data.mustHaves,
      cashMode: desiredValidated.data.cashMode, cashAmount: desiredValidated.data.cashAmount,
      lifeEventTags: validLifeEventKeys(body.lifeEventTags),
      homeFacts: extras.homeFacts, floorPlan: extras.floorPlan,
    },
  };
}

// The listing's kind (trade / buyer-only / rental) is fixed at creation and
// can't change via edit — only the data within that kind can be updated. This
// deliberately reuses validateListingInput's per-kind rules wholesale rather
// than re-deriving them, so the two paths can never drift apart.
// An edit body without a homeFacts (or floorPlan) key keeps what's stored (undefined = leave it alone in
// updateListing). A renters' pet policy stored on a listing that isn't a rental never renders (homeFacts.js).
export function validateListingEdit(existingIsBuyerOnly, existingIsRental, body) {
  const v = validateListingInput({ ...body, isBuyerOnly: existingIsBuyerOnly, isRental: existingIsRental });
  if (v.error) return v;
  const has = k => !!body && typeof body === 'object' && Object.hasOwn(body, k);
  if (!has('homeFacts')) v.data.homeFacts = undefined;
  if (!has('floorPlan')) v.data.floorPlan = undefined;
  return v;
}

export async function updateListing(db, id, userId, d) {
  const priceTier = priceTierFor(d.estimatedValue);
  // Home facts and the floor plan change only when the edit sent them (validateListingEdit), in the same statement.
  const extraCols = [];
  const extraValues = [];
  if (d.homeFacts !== undefined) { extraCols.push('home_facts_json = ?'); extraValues.push(JSON.stringify(d.homeFacts || {})); }
  if (d.floorPlan !== undefined) {
    const p = d.floorPlan || NO_FLOOR_PLAN;
    extraCols.push('plan_builder = ?', 'plan_name = ?', 'plan_community = ?', 'plan_key = ?', 'plan_twins = ?');
    extraValues.push(p.builder, p.name, p.community, p.key, p.showTwins ? 1 : 0);
  }
  const extraSql = extraCols.map(c => ` ${c},`).join('');

  await db.prepare(
    `UPDATE listings SET title = ?, description = ?, address = ?, neighborhood = ?, client_name = ?,
       city = ?, state = ?, property_type = ?, beds = ?, baths = ?, sqft = ?, estimated_value = ?,
       price_tier = ?, show_exact_address = ?, external_links = ?, rent_amount = ?, min_lease_months = ?,
       life_event_tags_json = ?,${extraSql} updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    d.title, d.description, d.address, d.neighborhood, d.clientName || null,
    d.city, d.state, d.propertyType, d.beds, d.baths, d.sqft, d.estimatedValue, priceTier,
    d.showExactAddress ? 1 : 0, JSON.stringify(d.externalLinks), d.rentAmount || 0, d.minLeaseMonths || 12,
    JSON.stringify(d.lifeEventTags || []), ...extraValues, id
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
  const plan = d.floorPlan || NO_FLOOR_PLAN;

  const result = await db.prepare(
    `INSERT INTO listings (user_id, title, description, address, neighborhood, client_name, city, state, property_type,
       beds, baths, sqft, estimated_value, price_tier, show_exact_address, external_links, is_buyer_only,
       is_rental, rent_amount, min_lease_months, life_event_tags_json,
       home_facts_json, plan_builder, plan_name, plan_community, plan_key, plan_twins)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, d.title, d.description, d.address, d.neighborhood, d.clientName || null,
    d.city, d.state, d.propertyType, d.beds, d.baths, d.sqft, d.estimatedValue, priceTier,
    d.showExactAddress ? 1 : 0, JSON.stringify(d.externalLinks), d.isBuyerOnly ? 1 : 0,
    d.isRental ? 1 : 0, d.rentAmount || 0, d.minLeaseMonths || 12, JSON.stringify(d.lifeEventTags || []),
    JSON.stringify(d.homeFacts || {}), plan.builder, plan.name, plan.community, plan.key, plan.showTwins ? 1 : 0
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
  // Saved-search alerts are sent by the callers in the background (context.waitUntil), not here: a scan of everyone's
  // searches inside the create request is what used to make big uploads time out.
  return listingId;
}
