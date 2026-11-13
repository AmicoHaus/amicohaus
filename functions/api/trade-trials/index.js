import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { verifyMutualPair } from '../../_lib/transactions.js';
import {
  TRIAL_CHECKLIST_ERROR, validateTrialDates, validateTrialChecklist, proposeTrial, fetchMyTrials, notifyTrialPartner,
  trialProposedNotice, trialAgreedNotice,
} from '../../_lib/tradeTrials.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Test-Drive Trade (tradeTrials.js): my trial stays, each with the other owner's name and home type and area. No
// address, ever. A block, a suspension or a listing that is no longer active hides a trial from both owners.
// 1 statement + the session.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'testDrive', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  return json({ trials: await fetchMyTrials(context.env.DB, user.id) }, NO_STORE);
}

// { listingIdA, listingIdB, startDate, endDate, checklist, longStayAck }: one owner of a mutual trade match suggests
// dates and ticks the checklist. The pair is re-verified exactly as a trade request is (transactions.js). The site
// records the pair, the dates, the ticks and the yes: no money, no address, no document. 6 statements + the session.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'testDrive', user)) return notFound('Not found.');
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const db = context.env.DB;
  const pair = await verifyMutualPair(db, user.id, body.listingIdA, body.listingIdB);
  if (pair.error) return badRequest(pair.error);
  const dates = validateTrialDates(body);
  if (dates.error) return badRequest(dates.error);
  const checklist = validateTrialChecklist(body.checklist);
  if (!checklist) return badRequest(TRIAL_CHECKLIST_ERROR);
  if (!(await claimUserAction(db, 'trade_trial', user.id, `pair:${pair.lowId}-${pair.highId}`))) return rateLimited();

  const trial = await proposeTrial(db, user.id, pair, dates.data, checklist);
  const partnerId = pair.rowLow.user_id === user.id ? pair.rowHigh.user_id : pair.rowLow.user_id;
  if (trial.notice) {
    const text = trial.notice === 'agreed'
      ? trialAgreedNotice(user.display_name, dates.data.startDate, dates.data.endDate)
      : trialProposedNotice(user.display_name, dates.data.startDate, dates.data.endDate);
    context.waitUntil(notifyTrialPartner(db, context.env, partnerId, text, trial.id).catch(err => console.log(`[trial notice failed] ${err && err.message}`)));
  }
  return json({ id: trial.id, status: trial.status }, { status: 201, ...NO_STORE });
}
