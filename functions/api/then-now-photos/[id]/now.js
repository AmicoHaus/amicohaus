import { serveThenNowPhoto } from '../../../_lib/thenNow.js';

// The "now" photo of a Then & Now pair (thenNow.js serveThenNowPhoto: only people who can open the pre-listing).
export async function onRequestGet(context) {
  return serveThenNowPhoto(context, 'now');
}
