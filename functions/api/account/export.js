import { getSessionUser } from '../../_lib/auth.js';
import { unauthorized } from '../../_lib/util.js';

// Self-serve data export (GDPR/CCPA-style access request) — everything the
// platform holds that's linked to this account, as a single downloadable file.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const [listings, posts, comments, messages, savedSearches, notifications, sharesGiven, sharesReceived, addressViews] = await Promise.all([
    db.prepare('SELECT * FROM listings WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM posts WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM comments WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM messages WHERE sender_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM saved_searches WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT * FROM notifications WHERE user_id = ?').bind(user.id).all(),
    // You're in Control: the record of each agent you shared your contact info with (and when), shares other
    // homeowners made with you, and "Who saw my address" on your own pre-listings.
    db.prepare('SELECT pre_listing_id, agent_id, shared_at FROM contact_shares WHERE owner_id = ?').bind(user.id).all(),
    db.prepare('SELECT pre_listing_id, owner_id, shared_at FROM contact_shares WHERE agent_id = ?').bind(user.id).all(),
    db.prepare('SELECT v.* FROM address_views v JOIN pre_listings p ON p.id = v.pre_listing_id WHERE p.user_id = ?').bind(user.id).all(),
  ]);

  const exportData = {
    account: { id: user.id, email: user.email, displayName: user.display_name, createdAt: user.created_at, signupIntent: user.signup_intent, signupSource: user.signup_source },
    listings: listings.results,
    posts: posts.results,
    comments: comments.results,
    messagesSent: messages.results,
    savedSearches: savedSearches.results,
    notifications: notifications.results,
    contactSettings: { contactMode: user.contact_mode, quietStart: user.quiet_start, quietEnd: user.quiet_end, phonePublic: !!user.phone_public },
    contactSharesGiven: sharesGiven.results,
    contactSharesReceived: sharesReceived.results,
    addressViewsOfMyHomes: addressViews.results,
    exportedAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="amicohaus-data-export.json"',
    },
  });
}
