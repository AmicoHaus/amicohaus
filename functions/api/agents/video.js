import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { scrubVideoUpload } from '../../_lib/videoMetadata.js';

// Generous but bounded — big enough for ~4 minutes of reasonably compressed
// video without risking the Worker's memory limit, since the body streams
// straight through to R2 (bucket.put(key, context.request.body, ...)) rather
// than being buffered in memory the way a multipart/form-data upload would
// be. The actual 4-minute cap is enforced client-side (checkVideoDuration in
// main.js) before the upload even starts — Workers has no way to decode
// video and check its duration server-side. The phone's recorded location is
// removed from the file on its way to R2 (videoMetadata.js).
// Cloudflare refuses request bodies over 100MB on this plan, so the limit sits just under that.
const MAX_VIDEO_BYTES = 95 * 1024 * 1024; // 95MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const agent = await db.prepare('SELECT video_r2_key FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
  if (!agent) return badRequest('Apply to become an agent before adding an intro video.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Video storage is not configured yet.' }, { status: 503 });

  const contentType = context.request.headers.get('Content-Type') || '';
  if (!ALLOWED_VIDEO_TYPES.includes(contentType)) return badRequest('Video must be MP4, WebM, or MOV.');

  const contentLength = Number(context.request.headers.get('Content-Length') || 0);
  if (!contentLength) return badRequest('Missing video file.');
  if (contentLength > MAX_VIDEO_BYTES) return badRequest('Video must be under 95MB — trim it down or export at 1080p.');

  const key = `agent-video/${user.id}/${crypto.randomUUID()}`;
  await bucket.put(key, scrubVideoUpload(context.request.body, contentLength), { httpMetadata: { contentType } });
  await db.prepare('UPDATE agent_profiles SET video_r2_key = ?, video_content_type = ? WHERE user_id = ?').bind(key, contentType, user.id).run();

  // Replace, don't accumulate — one intro video per agent. The old one goes only once the new one is stored, so a
  // failed upload never leaves the agent with no video.
  if (agent.video_r2_key) {
    try { await bucket.delete(agent.video_r2_key); } catch (err) { console.log(`[old intro video delete failed] ${err.message}`); }
  }
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const agent = await db.prepare('SELECT video_r2_key FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
  if (!agent || !agent.video_r2_key) return notFound('No video to remove.');

  const bucket = context.env.PHOTOS;
  if (bucket) await bucket.delete(agent.video_r2_key);
  await db.prepare('UPDATE agent_profiles SET video_r2_key = NULL, video_content_type = NULL WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true });
}
