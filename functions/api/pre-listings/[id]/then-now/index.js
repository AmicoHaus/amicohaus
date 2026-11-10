import { getSessionUser } from '../../../../_lib/auth.js';
import { scrubImageMetadata } from '../../../../_lib/imageMetadata.js';
import { claimUserAction, rateLimited } from '../../../../_lib/rateLimits.js';
import { deleteR2Keys } from '../../../../_lib/r2Cleanup.js';
import { json, badRequest, unauthorized, notFound } from '../../../../_lib/util.js';
import { preListingAccess, agentsOnly } from '../../../../_lib/visibility.js';
import {
  canSeePermits, fetchThenNow, ownerHomeForWrite, validatePairFields, photoProblem, NO_STORE,
  OWNER_REPORTED_LABEL, OWNER_REPORTED_LABEL_AGENT, MAX_PAIRS, PAIR_CAP_ERROR, RIGHTS_ERROR,
} from '../../../../_lib/thenNow.js';

// Then & Now for one home: the same people who can open the pre-listing (visibility.js) see the list and the photo
// pairs, always under the owner-reported label. Permit answers only go to the owner, the hired agent and agents with
// a contact share (thenNow.js canSeePermits); the "Sweep done" mark only to the owner.
export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const row = await db.prepare('SELECT id, user_id, status, awarded_bid_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!row) return notFound('Pre-listing not found.');
  const { access, isOwner, isAdmin, isApprovedAgent } = await preListingAccess(db, user, row);
  if (access === 'agents_only') return agentsOnly();
  if (access === 'hidden') return notFound('Pre-listing not found.');

  const permitsShown = await canSeePermits(db, row, user, { isOwner, isAdmin, isApprovedAgent });
  const { upgrades, pairs } = await fetchThenNow(db, row.id, { isOwner, showPermits: permitsShown });
  const out = { upgrades, pairs, permitsShown, label: isOwner ? OWNER_REPORTED_LABEL : OWNER_REPORTED_LABEL_AGENT };
  // The owner's panel hides its forms once the home is closed (read-only then).
  if (isOwner) out.canEdit = row.status !== 'closed';
  return json(out, NO_STORE);
}

// A new photo pair (owner only, while open or awarded): multipart then + now files, caption, thenYear, upgradeId,
// swept ('1' when the owner ticked "I checked this photo" on both in Privacy Sweep) and rights ('1', required).
// Both files lose their hidden metadata (GPS and the rest) before they're stored.
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const gate = await ownerHomeForWrite(db, id, user);
  if (gate.response) return gate.response;
  const home = gate.row;

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with "then" and "now" photo fields.'); }
  if (form.get('rights') !== '1') return badRequest(RIGHTS_ERROR);
  const thenFile = form.get('then');
  const nowFile = form.get('now');
  const fileError = photoProblem(thenFile) || photoProblem(nowFile);
  if (fileError) return badRequest(fileError);
  const fields = validatePairFields({ caption: form.get('caption'), thenYear: form.get('thenYear'), upgradeId: form.get('upgradeId') });
  if (fields.error) return badRequest(fields.error);
  const { caption, thenYear, upgradeId } = fields.data;

  // How many pairs there are, and whether the linked upgrade is on this home, in one look.
  const state = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM pre_listing_then_now WHERE pre_listing_id = ?1) AS n,
            (SELECT 1 FROM pre_listing_upgrades WHERE id = ?2 AND pre_listing_id = ?1) AS upgrade_ok`
  ).bind(home.id, upgradeId || 0).first();
  if (upgradeId && !state.upgrade_ok) return badRequest("That upgrade isn't on this home.");
  if (state.n >= MAX_PAIRS) return badRequest(PAIR_CAP_ERROR);

  if (!(await claimUserAction(db, 'photo_sweep', user.id, `pre_listing:${home.id}`))) return rateLimited();

  const thenKey = `pre-listing-then-now/${home.id}/${crypto.randomUUID()}`;
  const nowKey = `pre-listing-then-now/${home.id}/${crypto.randomUUID()}`;
  await bucket.put(thenKey, scrubImageMetadata(await thenFile.arrayBuffer(), thenFile.type), { httpMetadata: { contentType: thenFile.type } });
  await bucket.put(nowKey, scrubImageMetadata(await nowFile.arrayBuffer(), nowFile.type), { httpMetadata: { contentType: nowFile.type } });

  // The cap is checked again inside the INSERT, so two uploads at the same moment can't make a fifth pair.
  let result;
  try {
    result = await db.prepare(
      `INSERT INTO pre_listing_then_now (pre_listing_id, upgrade_id, caption, then_year, then_r2_key, then_content_type,
         now_r2_key, now_content_type, swept_at, position)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CASE WHEN ?9 = 1 THEN datetime('now') END,
         (SELECT COUNT(*) FROM pre_listing_then_now WHERE pre_listing_id = ?1)
       WHERE (SELECT COUNT(*) FROM pre_listing_then_now WHERE pre_listing_id = ?1) < ?10`
    ).bind(home.id, upgradeId, caption, thenYear, thenKey, thenFile.type, nowKey, nowFile.type,
      form.get('swept') === '1' ? 1 : 0, MAX_PAIRS).run();
  } catch (err) {
    await deleteR2Keys(bucket, [thenKey, nowKey]);
    throw err;
  }
  if (!result.meta || !result.meta.changes) {
    await deleteR2Keys(bucket, [thenKey, nowKey]);
    return badRequest(PAIR_CAP_ERROR);
  }
  return json({ id: result.meta.last_row_id }, { status: 201, ...NO_STORE });
}
