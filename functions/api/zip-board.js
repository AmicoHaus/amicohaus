import { json } from '../_lib/util.js';
import { fetchZipBoard, FOUNDING_SPOTS } from '../_lib/zipBoard.js';

// Public, no sign-in: the "Unlock your ZIP" board (see functions/_lib/zipBoard.js for what's counted and how).
export async function onRequestGet(context) {
  const zips = await fetchZipBoard(context.env.DB);
  return json({ zips, foundingSpots: FOUNDING_SPOTS }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
