// Weekly digest email content -- NOT yet wired to send automatically. This builds the subject/text/html for
// one user from real data (the same market_events/alerts tables Market Pulse already uses), but nothing in
// this file calls sendEmail() on a schedule. Activating a real weekly send to all users needs two things
// this file deliberately does NOT add on its own: an unsubscribe/opt-out mechanism (a recurring bulk email
// without one is both a bad experience and a compliance problem), and a Cron Trigger in wrangler.toml to
// actually run it. Both are a deliberate decision for the site owner, not something to switch on quietly.
import { escapeHtml, DEMO_EMAIL_PATTERN } from './util.js';
import { fetchMarketTrends } from './marketEvents.js';

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

// Real events from the last 7 days that match at least one of this user's saved Market Pulse alerts --
// same matching rules as checkMarketPulseAlerts(), run as a batch summary instead of one at a time.
async function fetchAlertMatchesThisWeek(db, userId) {
  const alerts = await db.prepare('SELECT id, label, event_type, entity_kind, city, state FROM market_pulse_alerts WHERE user_id = ?').bind(userId).all();
  if (!alerts.results.length) return [];

  const matches = [];
  for (const alert of alerts.results) {
    const conditions = [`created_at > datetime('now', '-7 days')`];
    const params = [];
    if (alert.event_type) { conditions.push('event_type = ?'); params.push(alert.event_type); }
    if (alert.entity_kind) { conditions.push('entity_kind = ?'); params.push(alert.entity_kind); }
    if (alert.city) { conditions.push('LOWER(city) = LOWER(?)'); params.push(alert.city); }
    if (alert.state) { conditions.push('LOWER(state) = LOWER(?)'); params.push(alert.state); }
    const rows = await db.prepare(
      `SELECT headline, created_at FROM market_events WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 5`
    ).bind(...params).all();
    if (rows.results.length) matches.push({ label: alert.label, events: rows.results });
  }
  return matches;
}

// Returns null when there's nothing worth emailing about (no saved alerts matched and the platform had no
// real 7-day activity at all) -- a digest with nothing in it is worse than no digest.
export async function buildWeeklyDigest(db, user) {
  const [trends, alertMatches] = await Promise.all([
    fetchMarketTrends(db),
    fetchAlertMatchesThisWeek(db, user.id),
  ]);

  const counts = trends.eventCounts7d || {};
  const totalThisWeek = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalThisWeek === 0 && alertMatches.length === 0) return null;

  const name = user.display_name || user.displayName || 'there';
  const platformLines = [
    counts.new_listing ? `${counts.new_listing} new listing${counts.new_listing === 1 ? '' : 's'}` : null,
    counts.price_drop ? `${counts.price_drop} price drop${counts.price_drop === 1 ? '' : 's'}` : null,
    counts.offer_accepted ? `${counts.offer_accepted} deal${counts.offer_accepted === 1 ? '' : 's'} closed` : null,
    counts.open_house_scheduled ? `${counts.open_house_scheduled} open house${counts.open_house_scheduled === 1 ? '' : 's'} scheduled` : null,
  ].filter(Boolean);
  const topCity = (trends.topCities7d || [])[0];

  const subject = alertMatches.length
    ? `Your Amico Haus alerts: ${alertMatches.reduce((n, m) => n + m.events.length, 0)} match${alertMatches.length === 1 && alertMatches[0].events.length === 1 ? '' : 'es'} this week`
    : 'Your Amico Haus weekly digest';

  const textParts = [`Hi ${name},`, '', "Here's what happened on Amico Haus this week:", ''];
  if (platformLines.length) textParts.push(...platformLines.map(l => `- ${l}`), '');
  if (topCity) textParts.push(`Busiest area: ${topCity.city}, ${topCity.state}`, '');
  if (alertMatches.length) {
    textParts.push('Matching your saved alerts:', '');
    for (const m of alertMatches) {
      textParts.push(`"${m.label}":`);
      textParts.push(...m.events.map(e => `  - ${e.headline}`));
      textParts.push('');
    }
  }
  textParts.push('See the full picture: https://amicohaus.com/app#marketpulse');
  const text = textParts.join('\n');

  const platformHtml = platformLines.length
    ? `<ul style="padding-left:20px;margin:8px 0">${platformLines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
    : '';
  const alertsHtml = alertMatches.length
    ? alertMatches.map(m => `
        <p style="margin:16px 0 4px;font-weight:600">"${escapeHtml(m.label)}"</p>
        <ul style="padding-left:20px;margin:4px 0">${m.events.map(e => `<li>${escapeHtml(e.headline)}</li>`).join('')}</ul>
      `).join('')
    : '';
  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2128">
  <p style="font-size:16px">Hi ${escapeHtml(name)},</p>
  <p style="font-size:16px">Here's what happened on Amico Haus this week:</p>
  ${platformHtml}
  ${topCity ? `<p style="font-size:14px;color:#667085">Busiest area: ${escapeHtml(topCity.city)}, ${escapeHtml(topCity.state)}</p>` : ''}
  ${alertsHtml}
  <p style="margin:28px 0"><a href="https://amicohaus.com/app#marketpulse" style="background:#a9793f;color:#201404;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9px;display:inline-block">See the full picture</a></p>
</div>`;

  return { subject, text, html };
}

// Users eligible for a digest: real accounts (never demo) with at least one saved Market Pulse alert, who
// haven't turned off match/activity emails -- reuses the SAME notify_matches preference the match-notify
// emails already respect (Account Settings), rather than inventing a separate opt-out just for this.
export async function fetchDigestRecipients(db) {
  const rows = await db.prepare(
    `SELECT DISTINCT users.id, users.email, users.display_name FROM users
     JOIN market_pulse_alerts ON market_pulse_alerts.user_id = users.id
     WHERE users.email NOT LIKE ? AND users.notify_matches != 0`
  ).bind(DEMO_EMAIL_PATTERN).all();
  return rows.results;
}
