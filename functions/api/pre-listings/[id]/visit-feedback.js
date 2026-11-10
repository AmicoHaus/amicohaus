import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { isApprovedAgent } from '../../../_lib/agents.js';
import { isEitherBlocked } from '../../../_lib/blocks.js';
import { ownerIsActive, agentsOnly } from '../../../_lib/visibility.js';
import { priceIsOpen } from '../../../_lib/preListings.js';
import { sqlUtc } from '../../../_lib/contactPolicy.js';
import { notifyVisitFeedback } from '../../../_lib/marketplaceNotify.js';
import {
  VISIT_KINDS, VISIT_EDIT_HOURS, validateVisitFeedback, eligibleVisitsFor, fetchVisitFeedbackForOwner, fetchMyVisitFeedback, editableUntil,
} from '../../../_lib/visitFeedback.js';

// 3-tap visit feedback on a pre-listing (visitFeedback.js). GET: the homeowner sees the answered cards; an approved
// agent sees the visits they can answer and their own answers (never anyone else's). PUT: an approved agent who
// visited saves or changes their answers (for 48 hours). Everything here is per viewer: private, no-store.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const noStore = (data, status = 200) => json(data, { status, ...NO_STORE });
const NOT_ELIGIBLE = { error: "That visit isn't open for feedback.", code: 'not_eligible' };

async function loadHome(db, id) {
  return db.prepare('SELECT id, user_id, status, asking_price FROM pre_listings WHERE id = ?').bind(Number(id)).first();
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const home = await loadHome(db, context.params.id);
  if (!home) return notFound('Pre-listing not found.');
  const open = home.status === 'open';

  if (home.user_id === user.id) {
    const rows = await fetchVisitFeedbackForOwner(db, home.id);
    return noStore({
      open,
      feedback: rows.map(r => {
        const approved = r.agent_status === 'approved';
        return {
          id: r.id,
          agent: {
            name: r.agent_name || '', licenseNumber: approved ? String(r.license_number || '').trim() : '',
            brokerageName: approved ? String(r.brokerage_name || '').trim() : '', isOperator: approved && r.agent_role === 'admin',
          },
          visitKind: r.visit_kind, visitAt: r.visit_at, price: r.price,
          // The answer was about an earlier asking price (the owner changed it since).
          aboutEarlierPrice: r.price !== null && r.asking_price_at !== home.asking_price,
          condition: r.condition, topPrep: r.top_prep, createdAt: r.created_at,
        };
      }),
    });
  }

  // Fair Play: an admin who is also an approved agent is treated as an agent here.
  if (await isApprovedAgent(db, user.id)) {
    if (!(await ownerIsActive(db, home.user_id)) || await isEitherBlocked(db, user.id, home.user_id)) return notFound('Pre-listing not found.');
    const eligible = await eligibleVisitsFor(db, home.id, user.id);
    const mine = await fetchMyVisitFeedback(db, home.id, user.id);
    return noStore({ open, priceOpen: priceIsOpen(home.asking_price), eligible, mine });
  }
  if (user.role === 'admin') return json({ error: 'Only the homeowner sees visit feedback.' }, { status: 403, ...NO_STORE });
  return agentsOnly();
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const home = await loadHome(db, context.params.id);
  if (!home) return notFound('Pre-listing not found.');
  if (home.user_id === user.id) return forbidden("Visit feedback comes from the agents who visit, so the homeowner can't leave it.");
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents who visited can leave visit feedback.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const visitKind = String(body.visitKind || '');
  const visitId = Number(body.visitId);
  if (!VISIT_KINDS.includes(visitKind) || !Number.isInteger(visitId) || visitId <= 0) return badRequest('Pick a visit.');

  const nowMs = Date.now();
  const visit = (await eligibleVisitsFor(db, home.id, user.id, nowMs)).find(v => v.visitKind === visitKind && v.visitId === visitId);
  if (!visit) return json(NOT_ELIGIBLE, { status: 404, ...NO_STORE });

  const existing = await db.prepare('SELECT skipped, created_at FROM pre_listing_visit_feedback WHERE visit_kind = ? AND visit_id = ? AND agent_user_id = ?')
    .bind(visitKind, visitId, user.id).first();
  const lockBefore = sqlUtc(nowMs - VISIT_EDIT_HOURS * 3600000);
  const LOCKED = { error: 'Feedback for this visit can no longer be changed.', code: 'locked' };
  if (existing && existing.created_at < lockBefore) return json(LOCKED, { status: 409, ...NO_STORE });

  const v = validateVisitFeedback(body, { priceOpen: priceIsOpen(home.asking_price) });
  if (v.error) return json({ error: v.error }, { status: 400, ...NO_STORE });
  const d = v.data;

  // One row per visit and agent. The lock is checked again in the same statement, so a save can't slip in late.
  const saved = await db.prepare(
    `INSERT INTO pre_listing_visit_feedback (pre_listing_id, agent_user_id, visit_kind, visit_id, visit_at, skipped, price, asking_price_at, condition, top_prep)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(visit_kind, visit_id, agent_user_id) DO UPDATE SET skipped = excluded.skipped, price = excluded.price,
       asking_price_at = excluded.asking_price_at, condition = excluded.condition, top_prep = excluded.top_prep, updated_at = datetime('now')
     WHERE pre_listing_visit_feedback.created_at >= ?11
     RETURNING created_at`
  ).bind(home.id, user.id, visitKind, visitId, visit.visitAt, d.skipped, d.price, d.price !== null ? home.asking_price : null,
    d.condition, d.topPrep, lockBefore).first();
  if (!saved) return json(LOCKED, { status: 409, ...NO_STORE });

  // The homeowner hears about the first real answers for a visit (not "I didn't make it", not later edits).
  if (!d.skipped && (!existing || existing.skipped)) {
    context.waitUntil(notifyVisitFeedback(context, home.id, home.user_id, user.id).catch(err => console.log(`[visit feedback notify failed] ${err.message}`)));
  }
  return noStore({ ok: true, editableUntil: editableUntil(saved.created_at) });
}
