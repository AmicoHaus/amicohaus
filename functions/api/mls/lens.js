import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import {
  LENS_TOOLS, TYPES, CTA, FIVE_YEAR_GATE, scopeList, resolveScope, typeKey, credit, pricePathView, marketPaceView, fiveYearView,
  featureLensView, daysCurveView, watcherCounts, watchersPulseView,
} from '../../_lib/mlsTools.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// The Market Pulse tab's MLS lenses for one ZIP code or area (?scope=91913 or ?scope=eastlake, ?type=all|sfr|attached):
// Price Path, Market Pace (+ the Five Years card), Feature Lens, Days to Sold and Watchers and Listings, each only when
// its tool is live (nuancedGate.js; on for everyone since Rudy's 11.16 broker OK). Signed-in members only (members,
// agents and admins; Rudy 11.17: no public page), like Area Pulse and Where My Home Fits: signed out gets the same 401.
// CRMLS aggregates from mlsAreaStats.js: no sale, address or MLS number. The session, plus 1 or 2 statements for the
// watcher counts when that tool is live.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  const live = LENS_TOOLS.filter(t => toolLive(context.env, t, user));
  if (!live.length) return notFound('Not found.');
  if (!user) return unauthorized();
  const url = new URL(context.request.url);
  const scopes = scopeList();
  const scope = resolveScope(url.searchParams.get('scope')) || resolveScope(scopes.length ? scopes[0].key : '');
  if (!scope) return json({ scopes: [], views: {}, types: Object.entries(TYPES).map(([key, label]) => ({ key, label })) }, NO_STORE);
  const type = typeKey(url.searchParams.get('type'));
  const views = {};
  if (live.includes('pricePath')) views.pricePath = pricePathView(scope, type);
  if (live.includes('marketPace')) views.marketPace = marketPaceView(scope, type);
  if (live.includes(FIVE_YEAR_GATE)) views.fiveYear = fiveYearView(scope, type);
  if (live.includes('featureLens')) views.featureLens = featureLensView(scope, type);
  if (live.includes('daysCurve')) views.daysCurve = daysCurveView(scope, type);
  if (live.includes('watchersPulse')) views.watchersPulse = watchersPulseView(scope, scope.kind === 'zip' ? await watcherCounts(context.env.DB, scope.key) : null);
  return json({
    scopes, scope: scope.key, type, types: Object.entries(TYPES).map(([key, label]) => ({ key, label })),
    views, credit: credit(scope), cta: CTA,
  }, NO_STORE);
}
