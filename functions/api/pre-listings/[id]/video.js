import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { isApprovedAgent } from '../../../_lib/agents.js';

// A short phone video walkthrough of the home, so agents can weigh in on the price without a visit. One per
// pre-listing; streamed straight to R2 (no buffering, same as an agent's intro video, see agents/video.js), and the
// 2-minute length cap is checked in the browser before upload since a Worker can't read a video's duration. Only
// the owner and approved agents can watch it: it shows the inside of a home that isn't on the market yet.
// Cloudflare refuses request bodies over 100MB on this plan, so the limit sits just under that.
const MAX_VIDEO_BYTES = 95 * 1024 * 1024; // 95MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

async function loadPreListing(db, id) {
  return db.prepare('SELECT user_id, status, video_r2_key, video_content_type FROM pre_listings WHERE id = ?').bind(id).first();
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const preListing = await loadPreListing(db, context.params.id);
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();
  if (preListing.status !== 'open') return badRequest('Only an open pre-listing can get a new video.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Video storage is not configured yet.' }, { status: 503 });
  const contentType = context.request.headers.get('Content-Type') || '';
  if (!ALLOWED_VIDEO_TYPES.includes(contentType)) return badRequest('The video must be MP4, MOV or WebM.');
  const contentLength = Number(context.request.headers.get('Content-Length') || 0);
  if (!contentLength) return badRequest('Missing video file.');
  if (contentLength > MAX_VIDEO_BYTES) return badRequest('The video must be under 95MB. Exporting at 1080p usually brings it under.');

  const key = `pre-listing-video/${context.params.id}/${crypto.randomUUID()}`;
  await bucket.put(key, context.request.body, { httpMetadata: { contentType } });
  await db.prepare('UPDATE pre_listings SET video_r2_key = ?, video_content_type = ? WHERE id = ?').bind(key, contentType, context.params.id).run();
  if (preListing.video_r2_key) {
    try { await bucket.delete(preListing.video_r2_key); } catch (err) { console.log(`[old video delete failed] ${err.message}`); }
  }
  // The end of the storage key goes in the video's URL, so browsers don't keep playing a replaced video from cache.
  return json({ ok: true, videoVersion: key.slice(-8) });
}

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const preListing = await loadPreListing(db, context.params.id);
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();
  if (!preListing.video_r2_key) return notFound('No video to remove.');
  await db.prepare('UPDATE pre_listings SET video_r2_key = NULL, video_content_type = NULL WHERE id = ?').bind(context.params.id).run();
  try { if (context.env.PHOTOS) await context.env.PHOTOS.delete(preListing.video_r2_key); } catch (err) { console.log(`[video delete failed] ${err.message}`); }
  return json({ ok: true });
}

// Range requests let the browser seek and start playing before the whole file arrives.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const preListing = await loadPreListing(db, context.params.id);
  if (!preListing || !preListing.video_r2_key) return notFound('No video for this pre-listing.');
  if (preListing.user_id !== user.id && !(await isApprovedAgent(db, user.id))) return forbidden();

  const bucket = context.env.PHOTOS;
  const head = bucket ? await bucket.head(preListing.video_r2_key) : null;
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
  const object = await bucket.get(preListing.video_r2_key, status === 206 ? { range: { offset, length } } : {});
  if (!object) return notFound('Video not found.');
  const headers = {
    'Content-Type': preListing.video_content_type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': String(length),
  };
  if (status === 206) headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${total}`;
  return new Response(object.body, { status, headers });
}
