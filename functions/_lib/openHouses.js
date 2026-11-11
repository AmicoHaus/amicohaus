// Open houses on a regular listing (augmentedHomeOpenHouses.js and greenHomeOpenHouses.js mirror this file).
// The shared code (note checks, address sharing, names, RSVP rules) lives in openHousePlan.js under the kind 'listing'.
import { validateOpenHouseBody, createKindOpenHouse, fetchKindOpenHouses } from './openHousePlan.js';

// Times, the note (fair housing, no street address, no codes: homeText.js) and the owner's address-share choice.
export function validateOpenHouseInput(body) {
  return validateOpenHouseBody(body);
}

export async function createOpenHouse(db, homeId, d) {
  return createKindOpenHouse(db, 'listing', homeId, d);
}

// Only upcoming ones, soonest first -- a past open house is just clutter by then. opts { ownerId, address }: the
// address goes only to a going, named viewer inside the window; the owner gets goingNames/goingBefore. RSVPs go
// through rsvpToggleResponse (openHousePlan.js).
export async function fetchOpenHouses(db, homeId, viewerUserId, opts = {}) {
  return fetchKindOpenHouses(db, 'listing', homeId, viewerUserId, opts);
}

