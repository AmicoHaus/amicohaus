// The Monday seller report (owner tools batch): one short email a week to a homeowner with an open pre-listing (or
// one hired in the last 30 days), counting what happened on their home on Amico Haus in the last 7 days, plus one
// next step. Owner only (never the hired agent). It's built to the commercial email standard (CAN-SPAM): a true
// subject, a one-click stop with no login (GET only shows the button; mail scanners open links), the postal line
// with Rudy's DRE # and broker, quiet hours honored, opt-out re-checked for held copies, never bundled with other
// mail. Jury test: no price, range, middle number, "value" or "worth", no street address or ZIP (emails get
// forwarded), no agent names, no buyer-demand trend, no tagline. Every count says "on Amico Haus only".
// Sent from the lazy job runner (functions/api/_middleware.js) Monday 07:00 Pacific through Wednesday, the same
// way as the agent scorecards (scorecard.js), and only once that week's scorecards are all claimed.
import { DEMO_EMAIL_PATTERN } from './util.js';
import { notBlockedByOwnersSql } from './blocks.js';
import { sendOrHoldEmail, SEND_GAP_MS } from './agentDuty.js';
import { quietHoursWindow, sqlUtc } from './contactPolicy.js';
import { confirmationCodeHash } from './emailConfirmation.js';
import { EMAIL_POSTAL_LINE } from './email.js';
import { scorecardWeek } from './scorecard.js';
import { allUnionAll } from './compoundSelect.js';

export const SELLER_REPORT_MAX_HOMES = 5;
const AWARDED_DAYS = 30;
const PACIFIC = 'America/Los_Angeles';

// "Nov 2 to Nov 9": the 7 days the counts cover (the same label as the agent scorecard).
function weekLabel(nowMs) {
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: PACIFIC });
  return `${fmt(nowMs - 7 * 86400000)} to ${fmt(nowMs)}`;
}

const pacificDate = (isoText) => new Date(isoText).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: PACIFIC });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A home's counts, all on this home, all from agents with no block either way with the owner. One statement for
// every home: each branch returns (home, kind, n). ?1 the home ids (JSON), ?2 since (SQL text), ?3 now (ISO).
const COUNTS_SQL = `
  SELECT v.pre_listing_id AS home, 'votes' AS kind, COUNT(*) AS n FROM pre_listing_price_votes v JOIN users a ON a.id = v.agent_user_id
   WHERE v.pre_listing_id IN (SELECT value FROM json_each(?1)) AND v.created_at >= ?2 AND a.status = 'active'
     AND ${notBlockedByOwnersSql('pre_listing', 'v.pre_listing_id', 'v.agent_user_id')} GROUP BY v.pre_listing_id
  UNION ALL SELECT o.pre_listing_id, 'opinions', COUNT(DISTINCT o.agent_user_id) FROM pre_listing_price_opinions o JOIN users a ON a.id = o.agent_user_id
   WHERE o.pre_listing_id IN (SELECT value FROM json_each(?1)) AND o.updated_at >= ?2 AND o.price_opinion IS NOT NULL AND a.status = 'active'
     AND ${notBlockedByOwnersSql('pre_listing', 'o.pre_listing_id', 'o.agent_user_id')} GROUP BY o.pre_listing_id
  UNION ALL SELECT b.request_id, 'proposals_live', COUNT(*) FROM service_bids b JOIN users a ON a.id = b.agent_user_id
   WHERE b.request_type = 'pre_listing' AND b.request_id IN (SELECT value FROM json_each(?1)) AND b.status = 'pending' AND a.status = 'active'
     AND ${notBlockedByOwnersSql('pre_listing', 'b.request_id', 'b.agent_user_id')} GROUP BY b.request_id
  UNION ALL SELECT b.request_id, 'proposals_new', COUNT(*) FROM service_bids b JOIN users a ON a.id = b.agent_user_id
   WHERE b.request_type = 'pre_listing' AND b.request_id IN (SELECT value FROM json_each(?1)) AND b.status != 'withdrawn' AND b.created_at >= ?2
     AND a.status = 'active' AND ${notBlockedByOwnersSql('pre_listing', 'b.request_id', 'b.agent_user_id')} GROUP BY b.request_id
  UNION ALL SELECT s.pre_listing_id, 'showings', COUNT(*) FROM pre_listing_showings s JOIN users a ON a.id = s.agent_user_id
   WHERE s.pre_listing_id IN (SELECT value FROM json_each(?1)) AND s.status = 'pending' AND s.proposed_at > ?3 AND a.status = 'active'
     AND ${notBlockedByOwnersSql('pre_listing', 's.pre_listing_id', 's.agent_user_id')} GROUP BY s.pre_listing_id
  UNION ALL SELECT pv.pre_listing_id, 'rsvps', COUNT(*) FROM pre_listing_preview_rsvps r JOIN pre_listing_previews pv ON pv.id = r.preview_id JOIN users a ON a.id = r.agent_user_id
   WHERE pv.pre_listing_id IN (SELECT value FROM json_each(?1)) AND r.created_at >= ?2 AND a.status = 'active'
     AND ${notBlockedByOwnersSql('pre_listing', 'pv.pre_listing_id', 'r.agent_user_id')} GROUP BY pv.pre_listing_id
  UNION ALL SELECT i.pre_listing_id, 'interviews', COUNT(*) FROM pre_listing_interviews i JOIN users a ON a.id = i.agent_user_id
   WHERE i.pre_listing_id IN (SELECT value FROM json_each(?1)) AND i.status = 'scheduled' AND i.updated_at >= ?2 AND a.status = 'active'
     AND ${notBlockedByOwnersSql('pre_listing', 'i.pre_listing_id', 'i.agent_user_id')} GROUP BY i.pre_listing_id
  UNION ALL SELECT f.pre_listing_id, 'feedback', COUNT(*) FROM pre_listing_visit_feedback f JOIN users a ON a.id = f.agent_user_id
   WHERE f.pre_listing_id IN (SELECT value FROM json_each(?1)) AND f.skipped = 0 AND f.created_at >= ?2 AND a.status = 'active'
     AND ${notBlockedByOwnersSql('pre_listing', 'f.pre_listing_id', 'f.agent_user_id')} GROUP BY f.pre_listing_id
  UNION ALL SELECT m.request_id, 'steps_total', COUNT(*) FROM bid_milestones m
   WHERE m.request_type = 'pre_listing' AND m.request_id IN (SELECT value FROM json_each(?1)) GROUP BY m.request_id
  UNION ALL SELECT m.request_id, 'steps_done', COALESCE(SUM(m.is_done), 0) FROM bid_milestones m
   WHERE m.request_type = 'pre_listing' AND m.request_id IN (SELECT value FROM json_each(?1)) GROUP BY m.request_id
  UNION ALL SELECT m.request_id, 'steps_done_week', COUNT(*) FROM bid_milestones m
   WHERE m.request_type = 'pre_listing' AND m.request_id IN (SELECT value FROM json_each(?1)) AND m.is_done = 1 AND m.done_at >= ?2 GROUP BY m.request_id`;

// The lines for one home (only nonzero ones) and its next step.
function homeLines(home, c, nowMs) {
  const sealed = home.status === 'open' && home.proposals_due_at && Date.parse(home.proposals_due_at) > nowMs;
  const lines = [];
  if (c.votes) lines.push(`${plural(c.votes, 'new price feedback vote', 'new price feedback votes')} from agents`);
  if (c.opinions) lines.push(`${plural(c.opinions, 'agent', 'agents')} shared a price opinion`);
  if (sealed && c.proposals_live) lines.push(`${plural(c.proposals_live, 'proposal', 'proposals')} waiting for your Decision Night on ${pacificDate(home.proposals_due_at)}`);
  else if (!sealed && c.proposals_new) lines.push(plural(c.proposals_new, 'new proposal', 'new proposals'));
  if (c.showings) lines.push(`${plural(c.showings, 'showing request', 'showing requests')} waiting for your answer`);
  if (c.rsvps) lines.push(`${plural(c.rsvps, 'agent', 'agents')} RSVP'd to your broker preview`);
  if (c.interviews) lines.push(`${plural(c.interviews, 'interview', 'interviews')} scheduled`);
  if (c.feedback) lines.push(`${plural(c.feedback, 'agent', 'agents')} left quick feedback after a visit. See what they said in the app.`);
  if (home.status === 'awarded' && c.steps_total) lines.push(`Hire checklist: ${c.steps_done || 0} of ${c.steps_total} steps checked`);
  // News this week: anything but the standing checklist line (a checklist step ticked this week counts).
  const news = !!(c.votes || c.opinions || (sealed ? c.proposals_live : c.proposals_new) || c.showings || c.rsvps || c.interviews || c.feedback || c.steps_done_week);
  const dnPassed = home.status === 'open' && home.proposals_due_at && Date.parse(home.proposals_due_at) <= nowMs;
  let nextStep = '';
  if (c.showings) nextStep = 'Answer your showing request.';
  else if (dnPassed && c.proposals_live) nextStep = 'Compare your proposals.';
  else if (home.status === 'open' && !home.has_video) nextStep = 'Add a walkthrough video.';
  else if (home.status === 'awarded') nextStep = 'Start your handoff binder.';
  return { lines, nextStep, news };
}

// null when the person isn't an active, real account with a home that qualifies. At most 3 statements: the person,
// their homes (up to 5), and one counts statement for all of them.
export async function buildSellerReport(db, userId, nowMs = Date.now()) {
  const user = await db.prepare(
    `SELECT id, email, display_name, quiet_start, quiet_end, seller_report_opt_out FROM users
     WHERE id = ? AND status = 'active' AND email NOT LIKE ?`
  ).bind(userId, DEMO_EMAIL_PATTERN).first();
  if (!user) return null;
  const homes = await db.prepare(
    `SELECT id, property_type, city, status, proposals_due_at, video_r2_key IS NOT NULL AS has_video FROM pre_listings
     WHERE user_id = ? AND (status = 'open' OR (status = 'awarded' AND COALESCE(awarded_at, updated_at) >= ?))
     ORDER BY created_at DESC, id DESC LIMIT ${SELLER_REPORT_MAX_HOMES}`
  ).bind(userId, sqlUtc(nowMs - AWARDED_DAYS * 86400000)).all();
  if (!homes.results.length) return null;
  const ids = homes.results.map(h => h.id);
  // 11 terms, run in chunks of at most 5 (D1 refuses a longer compound SELECT; compoundSelect.js).
  const rows = await allUnionAll(db, COUNTS_SQL, [JSON.stringify(ids), sqlUtc(nowMs - 7 * 86400000), new Date(nowMs).toISOString()], ['home', 'kind', 'n']);
  const counts = new Map(ids.map(id => [id, {}]));
  for (const r of rows) if (counts.has(r.home)) counts.get(r.home)[r.kind] = Number(r.n) || 0;
  return {
    email: user.email, name: user.display_name, duty: quietHoursWindow(user), weekLabel: weekLabel(nowMs),
    homes: homes.results.map(h => {
      const { lines, nextStep, news } = homeLines(h, counts.get(h.id), nowMs);
      return { id: h.id, propertyType: h.property_type, city: h.city, status: h.status, lines, nextStep, news };
    }),
  };
}

export async function sellerReportUnsubscribeToken(env, userId) {
  return (await confirmationCodeHash(env, userId, 'seller-report-unsubscribe')).slice(0, 32);
}

export async function sellerReportEmail(context, userId, report, nowMs = Date.now()) {
  const origin = new URL(context.request.url).origin;
  const label = report.weekLabel || weekLabel(nowMs);
  const blocks = report.homes.flatMap(h => [
    `${h.propertyType} in ${h.city}`,
    ...h.lines.map(l => `- ${l}`),
    ...(h.nextStep ? [`Next step: ${h.nextStep}`] : []),
    `Open your home: ${origin}/app#pre-listing-${h.id}`,
    '',
  ]);
  const lines = [
    `Hi ${report.name || 'there'},`, '',
    `Here's your week on Amico Haus (${label}). Everything below is activity on Amico Haus only.`, '',
    ...blocks,
    `You get this every Monday because you have a home on Amico Haus. Stop these emails: ${origin}/api/account/seller-report-unsubscribe?u=${userId}&t=${await sellerReportUnsubscribeToken(context.env, userId)}`,
    EMAIL_POSTAL_LINE,
  ];
  return { subject: `Your week on Amico Haus (${label})`, text: lines.join('\n') };
}

// Sends this week's seller reports a few at a time, exactly like runDueScorecards: each person is claimed for the
// week with a conditional UPDATE (two runs at once can't both send); nothing new this week means claimed, not
// emailed; a failed send releases the week for a later run (still Monday-Wednesday), up to 3 tries. The agent
// scorecards go first: while any of this week's scorecards is still unclaimed this returns 0 without claiming
// anyone (D1 allows about 50 statements per invocation). That check rides in the candidate SELECT (no extra
// statement). budgetMs: stop starting new people after this long.
export async function runDueSellerReports(context, { limit = 2, nowMs = Date.now(), budgetMs = 6000 } = {}) {
  const week = scorecardWeek(nowMs);
  if (!week) return 0;
  const startedAt = Date.now();
  const db = context.env.DB;
  const people = await db.prepare(
    `SELECT u.id, u.seller_report_week, u.seller_report_failures,
       (SELECT COUNT(*) FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
        WHERE agent_profiles.status = 'approved' AND agent_profiles.scorecard_opt_out = 0 AND users.status = 'active' AND users.email NOT LIKE ?1
          AND (agent_profiles.scorecard_sent_week IS NULL OR agent_profiles.scorecard_sent_week != ?2)) AS scorecards_left
     FROM users u
     WHERE u.status = 'active' AND u.email NOT LIKE ?1 AND lower(u.email) NOT LIKE '%@resend.dev' AND u.email_confirmation_pending = 0
       AND u.seller_report_opt_out = 0 AND (u.seller_report_week IS NULL OR u.seller_report_week != ?2)
       AND EXISTS (SELECT 1 FROM pre_listings p WHERE p.user_id = u.id
         AND (p.status = 'open' OR (p.status = 'awarded' AND COALESCE(p.awarded_at, p.updated_at) >= ?3)))
     ORDER BY u.id LIMIT ?4`
  ).bind(DEMO_EMAIL_PATTERN, week, sqlUtc(nowMs - AWARDED_DAYS * 86400000), limit).all();
  if (!people.results.length || people.results[0].scorecards_left > 0) return 0;
  let sent = 0;
  for (const u of people.results) {
    if (Date.now() - startedAt > budgetMs) break;
    const claim = await db.prepare(
      'UPDATE users SET seller_report_week = ? WHERE id = ? AND (seller_report_week IS NULL OR seller_report_week != ?)'
    ).bind(week, u.id, week).run();
    if (!claim.meta || !claim.meta.changes) continue;
    let ok = false;
    try {
      const report = await buildSellerReport(db, u.id, nowMs);
      if (!report || !report.email) continue;
      if (!report.homes.some(h => h.news)) continue; // nothing new this week: claimed, not emailed
      const { subject, text } = await sellerReportEmail(context, u.id, report, nowMs);
      ok = await sendOrHoldEmail(context, { userId: u.id, to: report.email, subject, text, duty: report.duty, kind: 'seller_report' }).catch(() => false);
    } catch (err) {
      console.log(`[seller report failed for ${u.id}] ${err && err.message}`);
    }
    if (!ok) {
      // Didn't go out: release the week so a later run tries again, up to 3 tries.
      if ((u.seller_report_failures || 0) < 2) {
        await db.prepare('UPDATE users SET seller_report_week = ?, seller_report_failures = seller_report_failures + 1 WHERE id = ? AND seller_report_week = ?').bind(u.seller_report_week, u.id, week).run();
      } else {
        await db.prepare('UPDATE users SET seller_report_failures = 0 WHERE id = ?').bind(u.id).run();
      }
      continue;
    }
    await db.prepare('UPDATE users SET seller_report_failures = 0 WHERE id = ?').bind(u.id).run();
    sent++;
    await new Promise(res => setTimeout(res, SEND_GAP_MS)); // the email provider allows about 2 a second
  }
  return sent;
}
