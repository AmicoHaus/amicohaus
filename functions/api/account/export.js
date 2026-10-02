import { getSessionUser } from '../../_lib/auth.js';
import { unauthorized } from '../../_lib/util.js';

// Self-serve data export (GDPR/CCPA-style access request) — everything the
// platform holds that's linked to this account, as a single downloadable file.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const [listings, posts, comments, messages, savedSearches, notifications] = await Promise.all([
    db.prepare('SELECT * FROM listings WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM posts WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM comments WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM messages WHERE sender_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM saved_searches WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM notifications WHERE user_id = ?').bind(user.id).all(),
  ]);

  const exportData = {
    account: { id: user.id, email: user.email, displayName: user.display_name, createdAt: user.created_at },
    listings: listings.results,
    posts: posts.results,
    comments: comments.results,
    messagesSent: messages.results,
    savedSearches: savedSearches.results,
    notifications: notifications.results,
    exportedAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="amicohaus-data-export.json"',
    },
  });
}
