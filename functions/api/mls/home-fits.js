import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { TYPES, FITS_LINE, coveredZips, validateHomeFits, homeFitsView } from '../../_lib/mlsTools.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const types = () => Object.entries(TYPES).map(([key, label]) => ({ key, label }));

// Where My Home Fits (gate homeFits, on for everyone since 11.16; signed-in members only, because its answer turns into
// a pre-listing showcase draft in the signed-in app). GET: the ZIP codes the MLS numbers
// cover. POST { zip, type, beds, baths, sqft, lot, year, stories, garage }: where each lands among recent sales there
// (sizes, years and counts; never a price), plus the showcase draft the app copies into the pre-listing form.
// Nothing is stored. The session only (no other statement).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'homeFits', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  return json({ zips: coveredZips(), types: types(), line: FITS_LINE }, NO_STORE);
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'homeFits', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const { data, error } = validateHomeFits(body);
  if (error) return badRequest(error);
  return json({ view: homeFitsView(data) }, NO_STORE);
}
