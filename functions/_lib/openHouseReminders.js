// Open-house RSVP reminder content + dispatcher -- NOT yet wired to send automatically. This mirrors
// weeklyDigest.js exactly: the email content and the "send to everyone who's due" logic are both built and
// ready, but nothing here calls it on a schedule. Turning it on for real needs a Cron Trigger in
// wrangler.toml (there isn't one yet) -- a deliberate decision for the site owner, not something to switch
// on quietly. Until then, functions/api/admin/send-open-house-reminder-preview.js lets the admin see what
// the email would look like, sent only to their own address.
import { DEMO_EMAIL_PATTERN, escapeHtml } from './util.js';

const KIND_CONFIG = {
  listing: {
    ohTable: 'open_houses', rsvpTable: 'open_house_rsvps', ohFk: 'listing_id',
    entityTable: 'listings', entityLabel: 'title', href: id => `https://amicohaus.com/listing/${id}`,
  },
  augmented_home: {
    ohTable: 'augmented_home_open_houses', rsvpTable: 'augmented_home_open_house_rsvps', ohFk: 'augmented_home_id',
    entityTable: 'augmented_homes', entityLabel: 'title', href: id => `https://amicohaus.com/augmented-home/${id}`,
  },
  green_home: {
    ohTable: 'green_home_open_houses', rsvpTable: 'green_home_open_house_rsvps', ohFk: 'green_home_id',
    entityTable: 'green_homes', entityLabel: 'title', href: id => `https://amicohaus.com/green-home/${id}`,
  },
};

// Open houses starting within the next `windowHours` (and still in the future) that haven't had a reminder
// sent yet, across all 3 kinds -- each with enough entity detail to build the email and link back.
export async function fetchDueOpenHouseReminders(db, windowHours = 24) {
  const due = [];
  for (const [entityKind, c] of Object.entries(KIND_CONFIG)) {
    const rows = await db.prepare(
      `SELECT ${c.ohTable}.id AS oh_id, ${c.ohTable}.starts_at, ${c.ohTable}.ends_at, ${c.ohTable}.${c.ohFk} AS entity_id,
              ${c.entityTable}.${c.entityLabel} AS title, ${c.entityTable}.property_type, ${c.entityTable}.city, ${c.entityTable}.state
       FROM ${c.ohTable}
       JOIN ${c.entityTable} ON ${c.entityTable}.id = ${c.ohTable}.${c.ohFk}
       JOIN users ON users.id = ${c.entityTable}.user_id
       WHERE ${c.ohTable}.starts_at > datetime('now') AND ${c.ohTable}.starts_at <= datetime('now', ?)
         AND users.email NOT LIKE ?
         AND NOT EXISTS (SELECT 1 FROM open_house_reminders_sent WHERE entity_kind = ? AND open_house_id = ${c.ohTable}.id)
       ORDER BY ${c.ohTable}.starts_at ASC`
    ).bind(`+${windowHours} hours`, DEMO_EMAIL_PATTERN, entityKind).all();
    for (const r of rows.results) {
      due.push({
        entityKind, openHouseId: r.oh_id, startsAt: r.starts_at, endsAt: r.ends_at,
        entityId: r.entity_id, title: r.title || r.property_type, city: r.city, state: r.state,
        href: c.href(r.entity_id),
      });
    }
  }
  return due;
}

export async function fetchRsvpRecipients(db, entityKind, openHouseId) {
  const c = KIND_CONFIG[entityKind];
  if (!c) return [];
  const rows = await db.prepare(
    `SELECT users.id, users.email, users.display_name FROM ${c.rsvpTable}
     JOIN users ON users.id = ${c.rsvpTable}.user_id
     WHERE ${c.rsvpTable}.open_house_id = ? AND users.email NOT LIKE ?`
  ).bind(openHouseId, DEMO_EMAIL_PATTERN).all();
  return rows.results;
}

export function buildOpenHouseReminderEmail(openHouse, recipientName) {
  // openHouse.startsAt is already a full ISO string (open_houses.starts_at is written via
  // Date.prototype.toISOString() in openHouses.js, unlike created_at/changed_at columns which use SQLite's
  // bare datetime('now') and need a 'Z' appended) -- parse it directly, same as the public listing page does.
  const when = new Date(openHouse.startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const name = recipientName || 'there';
  const subject = `Reminder: open house for ${openHouse.title} is coming up`;
  const text = `Hi ${name},\n\nJust a reminder — the open house you RSVP'd to is coming up:\n\n${openHouse.title}\n${openHouse.city}, ${openHouse.state}\n${when}\n\nSee it on Amico Haus: ${openHouse.href}\n`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2128">
  <p style="font-size:16px">Hi ${escapeHtml(name)},</p>
  <p style="font-size:16px">Just a reminder — the open house you RSVP'd to is coming up:</p>
  <p style="font-size:16px;font-weight:600;margin:4px 0">${escapeHtml(openHouse.title)}</p>
  <p style="font-size:14px;color:#667085;margin:0 0 4px">${escapeHtml(openHouse.city)}, ${escapeHtml(openHouse.state)}</p>
  <p style="font-size:14px;color:#667085;margin:0 0 16px">${escapeHtml(when)}</p>
  <p style="margin:20px 0"><a href="${openHouse.href}" style="background:#a9793f;color:#201404;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9px;display:inline-block">View on Amico Haus</a></p>
</div>`;
  return { subject, text, html };
}

// Marks a reminder as sent so fetchDueOpenHouseReminders() never returns it again -- called once per open
// house after its recipients have been emailed, by whatever eventually calls this on a schedule.
export async function markReminderSent(db, entityKind, openHouseId) {
  await db.prepare('INSERT OR IGNORE INTO open_house_reminders_sent (entity_kind, open_house_id) VALUES (?, ?)').bind(entityKind, openHouseId).run();
}
