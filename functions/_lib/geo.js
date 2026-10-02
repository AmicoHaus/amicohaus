// Zip-radius service areas for agents — "up to 4 zip codes, each with a 20
// mile radius" (fixed, not agent-configurable). Distance is computed via the
// haversine formula against zip_codes, a static reference table of US ZCTA
// centroids (see zip_codes_data.sql) — approximate (a zip's centroid, not a
// property's exact address), which is the right level of precision for a
// 20-mile service-area decision.
export const SERVICE_RADIUS_MILES = 20;
export const MAX_SERVICE_ZIPS = 4;
// A "local specialist" is someone whose declared service zips all cluster
// within this many miles of each other — the same fixed radius already used
// for how far any one service zip reaches, reused here as the threshold for
// "this is one coherent area" rather than several unrelated ones.
export const LOCAL_SPECIALIST_SPREAD_MILES = 20;
const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineMiles(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function lookupZipCoords(db, zips) {
  const clean = [...new Set((zips || []).filter(z => /^\d{5}$/.test(z)))];
  const map = new Map();
  if (clean.length === 0) return map;
  const placeholders = clean.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT zip, lat, lng FROM zip_codes WHERE zip IN (${placeholders})`).bind(...clean).all();
  for (const r of rows.results) map.set(r.zip, { lat: r.lat, lng: r.lng });
  return map;
}

export function validateServiceZips(input) {
  const zips = [...new Set((Array.isArray(input) ? input : []).map(z => String(z).trim()).filter(Boolean))].slice(0, MAX_SERVICE_ZIPS);
  return zips;
}

// Returns the shortest distance (miles) from targetZip to any of the
// agent's service zips, or null if either side's coordinates aren't known
// (an invalid/unrecognized zip) — callers treat null as "can't tell", not
// "in range".
export function nearestServiceDistance(targetCoords, serviceZips, coordsByZip) {
  if (!targetCoords) return null;
  let best = null;
  for (const zip of serviceZips) {
    const coords = coordsByZip.get(zip);
    if (!coords) continue;
    const d = haversineMiles(targetCoords.lat, targetCoords.lng, coords.lat, coords.lng);
    if (best === null || d < best) best = d;
  }
  return best;
}

// The largest distance between any two of an agent's own service zips — a
// proxy for "one coherent local area" vs. "several scattered, unrelated
// areas". A single zip (or none) trivially has a spread of 0. Returns null
// only if none of the zips resolved to known coordinates.
export function serviceAreaSpread(serviceZips, coordsByZip) {
  const coords = serviceZips.map(z => coordsByZip.get(z)).filter(Boolean);
  if (coords.length === 0) return null;
  if (coords.length === 1) return 0;
  let max = 0;
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const d = haversineMiles(coords[i].lat, coords[i].lng, coords[j].lat, coords[j].lng);
      if (d > max) max = d;
    }
  }
  return max;
}
