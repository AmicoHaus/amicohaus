import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { isApprovedAgent } from '../../../_lib/agents.js';
import { proposalsSealed } from '../../../_lib/decisionNight.js';

// Pitch Reels: a 15-60 second video an agent records for one specific home, attached to their proposal. Only the
// homeowner (once their proposals are open) and the agent who made it can watch it. Streamed straight to R2 like
// the pre-listing video tour (video.js); the length is checked in the browser, since a Worker can't read a video's
// duration. Cloudflare refuses request bodies over 100MB on this plan, so the limit sits just under that.
const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

async function loadBid(db, preListingId, agentUserId) {
  return db.prepare(
    `SELECT pl.user_id AS owner_id, pl.status AS pre_listing_status, pl.proposals_due_at,
            b.id AS bid_id, b.status AS bid_status, b.pitch_video_r2_key, b.pitch_video_content_type
     FROM pre_listings pl LEFT JOIN service_bids b ON b.request_type = 'pre_listing' AND b.request_id = pl.id AND b.agent_user_id = ?
     WHERE pl.id = ?`
  ).bind(agentUserId, preListingId).first();
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can add a pitch reel.');
  const row = await loadBid(db, context.params.id, user.id);
  if (!row) return notFound('Pre-listing not found.');
  if (!row.bid_id || row.bid_status !== 'pending') return badRequest('Send your proposal first, then add a pitch reel to it.');
  if (row.pre_listing_status !== 'open') return badRequest('This pre-listing is no longer open for proposals.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Video storage is not configured yet.' }, { status: 503 });
  const contentType = context.request.headers.get('Content-Type') || '';
  if (!ALLOWED_VIDEO_TYPES.includes(contentType)) return badRequest('The video must be MP4, MOV or WebM.');
  const contentLength = Number(context.request.headers.get('Content-Length') || 0);
  if (!contentLength) return badRequest('Missing video file.');
  if (contentLength > MAX_VIDEO_BYTES) return badRequest('The video must be under 95MB. Recording at 1080p usually keeps a 60-second clip under.');

  const key = `pre-listing-pitch/${context.params.id}/${user.id}/${crypto.randomUUID()}`;
  await bucket.put(key, context.request.body, { httpMetadata: { contentType } });
  await db.prepare('UPDATE service_bids SET pitch_video_r2_key = ?, pitch_video_content_type = ? WHERE id = ?').bind(key, contentType, row.bid_id).run();
  if (row.pitch_video_r2_key) {
    try { await bucket.delete(row.pitch_video_r2_key); } catch (err) { console.log(`[old pitch delete failed] ${err.message}`); }
  }
  return json({ ok: true, pitchVersion: key.slice(-8) });
}

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const row = await loadBid(db, context.params.id, user.id);
  if (!row || !row.bid_id || !row.pitch_video_r2_key) return notFound('No pitch reel to remove.');
  await db.prepare('UPDATE service_bids SET pitch_video_r2_key = NULL, pitch_video_content_type = NULL WHERE id = ?').bind(row.bid_id).run();
  try { if (context.env.PHOTOS) await context.env.PHOTOS.delete(row.pitch_video_r2_key); } catch (err) { console.log(`[pitch delete failed] ${err.message}`); }
  return json({ ok: true });
}

// ?agent=<id>: the homeowner watching one agent's reel (only once Decision Night has passed, and never a withdrawn
// proposal's), or the agent watching their own. Range requests let it seek and start before the whole file arrives.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const agentId = Number(new URL(context.request.url).searchParams.get('agent')) || user.id;
  if (agentId !== user.id) {
    // The owner, once their proposals are open. Checked before looking for the reel, so the answer never hints at
    // which agents sent one.
    const pl = await db.prepare('SELECT user_id, status, proposals_due_at FROM pre_listings WHERE id = ?').bind(context.params.id).first();
    if (!pl || pl.user_id !== user.id) return forbidden();
    if (proposalsSealed(pl)) return forbidden('Your proposals open together on your Decision Night.');
  }
  const row = await loadBid(db, context.params.id, agentId);
  if (!row || !row.bid_id || !row.pitch_video_r2_key) return notFound('No pitch reel here.');
  if (agentId !== user.id) {
    if (row.bid_status === 'withdrawn') return notFound('No pitch reel here.');
    // Same rule as the owner's proposal list: a suspended agent's proposal (and reel) drops out unless already hired.
    const agent = await db.prepare('SELECT status FROM users WHERE id = ?').bind(agentId).first();
    if ((!agent || agent.status !== 'active') && row.bid_status !== 'accepted') return notFound('No pitch reel here.');
  }

  const bucket = context.env.PHOTOS;
  const head = bucket ? await bucket.head(row.pitch_video_r2_key) : null;
  if (!head) return notFound('Video not found.');
  const total = head.size;
  let offset = 0;
  let length = total;
  let status = 200;
  const match = /bytes=(\d+)-(\d*)/.exec(context.request.headers.get('Range') || '');
  if (match) {
    offset = Math.min(Number(match[1]), Math.max(total - 1, 0));
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    length = Math.max(end - offset + 1, 0);
    status = 206;
  }
  const object = await bucket.get(row.pitch_video_r2_key, status === 206 ? { range: { offset, length } } : {});
  if (!object) return notFound('Video not found.');
  const headers = {
    'Content-Type': row.pitch_video_content_type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': String(length),
  };
  if (status === 206) headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${total}`;
  return new Response(object.body, { status, headers });
}
