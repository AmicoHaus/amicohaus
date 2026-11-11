// Open houses on an AugmentedHomes listing. Mirrors functions/_lib/openHouses.js exactly.
// The shared code (note checks, address sharing, names, RSVP rules) lives in openHousePlan.js under the kind 'augmented_home'.
import { validateOpenHouseBody, createKindOpenHouse, fetchKindOpenHouses } from './openHousePlan.js';

// Times, the note (fair housing, no street address, no codes: homeText.js) and the owner's address-share choice.
export function validateOpenHouseInput(body) {
  return validateOpenHouseBody(body);
}

export async function createOpenHouse(db, homeId, d) {
  return createKindOpenHouse(db, 'augmented_home', homeId, d);
}

// Only upcoming ones, soonest first -- a past open house is just clutter by then. opts { ownerId, address }: the
// address goes only to a going, named viewer inside the window; the owner gets goingNames/goingBefore. RSVPs go
// through rsvpToggleResponse (openHousePlan.js).
export async function fetchOpenHouses(db, homeId, viewerUserId, opts = {}) {
  return fetchKindOpenHouses(db, 'augmented_home', homeId, viewerUserId, opts);
}

