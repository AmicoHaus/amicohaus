import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../../_lib/util.js';

// Defaults to pending (the admin's actual queue) but takes ?status= to also
// review past decisions.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const url = new URL(context.request.url);
  const status = ['pending', 'approved', 'rejected'].includes(url.searchParams.get('status'))
    ? url.searchParams.get('status') : 'pending';

  const rows = await context.env.DB.prepare(
    `SELECT agent_profiles.*, users.display_name, users.email
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.status = ?
     ORDER BY agent_profiles.applied_at DESC`
  ).bind(status).all();

  const applications = rows.results.map(r => ({
    userId: r.user_id, displayName: r.display_name, email: r.email,
    status: r.status, brokerageName: r.brokerage_name, licenseNumber: r.license_number,
    yearsExperience: r.years_experience, bio: r.bio,
    defaultCommissionPct: r.default_commission_pct, defaultFlatFee: r.default_flat_fee,
    services: JSON.parse(r.services_json || '[]'),
    serviceZips: JSON.parse(r.service_zips_json || '[]'),
    openHouseDays: JSON.parse(r.open_house_days_json || '[]'),
    avgDaysOnMarket: r.avg_days_on_market, homesSoldLastYear: r.homes_sold_last_year,
    hasVideo: !!r.video_r2_key,
    hasLicensePhoto: !!r.license_photo_r2_key, licenseVerified: !!r.license_verified,
    appliedAt: r.applied_at, reviewedAt: r.reviewed_at, rejectionReason: r.rejection_reason,
  }));

  return json({ applications });
}
