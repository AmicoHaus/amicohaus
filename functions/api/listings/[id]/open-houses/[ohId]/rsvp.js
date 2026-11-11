import { getSessionUser } from '../../../../../_lib/auth.js';
import { unauthorized } from '../../../../../_lib/util.js';
import { rsvpToggleResponse } from '../../../../../_lib/openHousePlan.js';

// Toggle "I'm Going". One statement loads the open house, home and owner; a paused home, a suspended owner, a block
// either way or (when adding) an ended open house gets the same 404 as a missing one; adding is rate limited
// (open_house_rsvp). Response { going, address }: the address only when the owner shares it and the window is open.
export async function onRequestPost(context) {
  const { id: listingId, ohId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  return rsvpToggleResponse(context.env.DB, 'listing', listingId, ohId, user);
}
