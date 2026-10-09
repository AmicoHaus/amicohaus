// Open houses on a GreenHomes listing. Mirrors functions/_lib/openHouses.js exactly.
import { clampString } from './util.js';

export function validateOpenHouseInput(body) {
  const starts = new Date(body.startsAt);
  const ends = new Date(body.endsAt);
  if (isNaN(starts.getTime()) || isNaN(ends.getTime())) return { error: 'Pick a start and end time.' };
  if (starts.getTime() <= Date.now()) return { error: 'The open house has to be in the future.' };
  if (ends.getTime() <= starts.getTime()) return { error: 'The end time has to be after the start time.' };
  return { data: { startsAt: starts.toISOString(), endsAt: ends.toISOString(), note: clampString(body.note, 300) } };
}

export async function createOpenHouse(db, homeId, d) {
  const result = await db.prepare(
    'INSERT INTO green_home_open_houses (green_home_id, starts_at, ends_at, note) VALUES (?, ?, ?, ?)'
  ).bind(homeId, d.startsAt, d.endsAt, d.note).run();
  return result.meta.last_row_id;
}

export async function fetchOpenHouses(db, homeId, viewerUserId) {
  const rows = await db.prepare(
    `SELECT green_home_open_houses.id, green_home_open_houses.starts_at, green_home_open_houses.ends_at, green_home_open_houses.note,
            (SELECT COUNT(*) FROM green_home_open_house_rsvps WHERE green_home_open_house_rsvps.open_house_id = green_home_open_houses.id) AS rsvp_count
     FROM green_home_open_houses WHERE green_home_open_houses.green_home_id = ? AND green_home_open_houses.ends_at > datetime('now') ORDER BY green_home_open_houses.starts_at ASC`
  ).bind(homeId).all();

  let rsvpedIds = new Set();
  if (viewerUserId && rows.results.length) {
    const ids = rows.results.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const mine = await db.prepare(`SELECT open_house_id FROM green_home_open_house_rsvps WHERE user_id = ? AND open_house_id IN (${placeholders})`).bind(viewerUserId, ...ids).all();
    rsvpedIds = new Set(mine.results.map(r => r.open_house_id));
  }
  return rows.results.map(r => ({
    id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, note: r.note, rsvpCount: r.rsvp_count, imGoing: rsvpedIds.has(r.id),
  }));
}

export async function toggleRsvp(db, openHouseId, userId) {
  const existing = await db.prepare('SELECT id FROM green_home_open_house_rsvps WHERE open_house_id = ? AND user_id = ?').bind(openHouseId, userId).first();
  if (existing) {
    await db.prepare('DELETE FROM green_home_open_house_rsvps WHERE id = ?').bind(existing.id).run();
    return { going: false };
  }
  await db.prepare('INSERT INTO green_home_open_house_rsvps (open_house_id, user_id) VALUES (?, ?)').bind(openHouseId, userId).run();
  return { going: true };
}
