import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { logAdminAction } from '../../../../_lib/audit.js';

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const applicantId = context.params.id;
  const db = context.env.DB;
  const existing = await db.prepare('SELECT license_number FROM agent_profiles WHERE user_id = ?').bind(applicantId).first();
  if (!existing) return notFound('No application from this user.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  // "Checked on the DRE": the admin looked the license up on the DRE's public lookup (dreLookupUrl), with or
  // without a license photo. Re-checking later just refreshes the date. The check is tied to the number the admin
  // was shown: if the agent changed it since the page loaded, nothing is stamped and the admin is asked to reload.
  const verified = !!body.verified;
  if (verified) {
    const licenseNumber = String(body.licenseNumber || '');
    if (!licenseNumber) return badRequest('Send the license number you checked.');
    const stamped = await db.prepare(
      "UPDATE agent_profiles SET license_verified = 1, license_verified_at = datetime('now'), license_verified_by = ? WHERE user_id = ? AND license_number = ?"
    ).bind(user.id, applicantId, licenseNumber).run();
    if (!stamped.meta.changes) {
      return json({ error: "This agent's license number changed since the page loaded. Reload, then check the new number on the DRE." }, { status: 409 });
    }
  } else {
    // "License not active": the check comes off entirely (no date), so the profile stops saying it was checked.
    await db.prepare(
      'UPDATE agent_profiles SET license_verified = 0, license_verified_at = NULL, license_verified_by = ? WHERE user_id = ?'
    ).bind(user.id, applicantId).run();
  }
  await logAdminAction(db, user.id, verified ? 'license_verified' : 'license_unverified', 'agent_profile', applicantId);

  return json({ ok: true });
}
