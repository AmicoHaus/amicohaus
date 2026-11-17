import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { fetchWatchAreas } from '../../_lib/watchAreas.js';
import { areaPulseCard, areaPulseEmail, AREA_PULSE_EMAIL_LIVE, NO_WATCH_AREAS_LINE, CTA } from '../../_lib/mlsTools.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Area Pulse: one card of CRMLS numbers for each of the member's watch areas (whole ZIP codes; gate areaPulse, on for
// everyone since 11.16, but it reads the member's own watch areas, so signed in only). ?email=1, admins only: the monthly email as it would read for these cards. Nothing is sent
// (AREA_PULSE_EMAIL_LIVE is false and no job runs it). 1 statement + the session.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'areaPulse', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const areas = await fetchWatchAreas(context.env.DB, user.id);
  const cards = areas.map(a => areaPulseCard(a.zip, a.label));
  const out = { cards, empty: areas.length ? '' : NO_WATCH_AREAS_LINE, cta: CTA, emailLive: AREA_PULSE_EMAIL_LIVE };
  if (new URL(context.request.url).searchParams.get('email') === '1' && user.role === 'admin') out.emailPreview = areaPulseEmail(cards, { stopUrl: 'https://amicohaus.com/(one-click stop link goes here)' });
  return json(out, NO_STORE);
}
