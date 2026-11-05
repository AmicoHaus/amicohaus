import { notFound } from '../../_lib/util.js';
import { mediaCacheControl } from '../../_lib/visibility.js';

// Public for an approved agent with an active account, and supports Range requests — without it, a browser can't
// seek within the video or start playing before the whole file downloads, which matters a lot more for a
// few-minutes-long video than it does for a photo. A pending, rejected or suspended applicant's video goes only to
// themself and admins (the admin review screen plays it).
export async function onRequestGet(context) {
  const db = context.env.DB;
  const agent = await db.prepare(
    `SELECT ap.user_id, ap.status AS agent_status, ap.video_r2_key, ap.video_content_type, u.status AS user_status
     FROM agent_profiles ap JOIN users u ON u.id = ap.user_id WHERE ap.user_id = ?`
  ).bind(context.params.id).first();
  if (!agent || !agent.video_r2_key) return notFound('No video for this agent.');
  // Same URL after an agent replaces their video, so the public copy can't be cached for long.
  const isPublic = agent.agent_status === 'approved' && agent.user_status === 'active';
  const cacheControl = await mediaCacheControl(context, isPublic, agent.user_id, 'public, max-age=3600');
  if (!cacheControl) return notFound('No video for this agent.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Video storage is not configured.');

  const head = await bucket.head(agent.video_r2_key);
  if (!head) return notFound('Video not found.');
  const totalSize = head.size;

  let offset = 0;
  let length = totalSize;
  let status = 200;
  const rangeHeader = context.request.headers.get('Range');
  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      offset = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), totalSize - 1) : totalSize - 1;
      length = end - offset + 1;
      status = 206;
    }
  }

  const object = await bucket.get(agent.video_r2_key, status === 206 ? { range: { offset, length } } : {});
  if (!object) return notFound('Video not found.');

  const headers = {
    'Content-Type': agent.video_content_type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'Content-Length': String(length),
  };
  if (status === 206) headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${totalSize}`;

  return new Response(object.body, { status, headers });
}
