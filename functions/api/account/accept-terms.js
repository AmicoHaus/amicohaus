import { getSessionUser } from '../../_lib/auth.js';
import { json } from '../../_lib/util.js';
import { CURRENT_TERMS_VERSION } from '../../_lib/terms.js';

// "I agree" on the one-time "We updated our Terms" notice in /app: records which Terms of Use / Privacy Policy
// version the account agreed to and when (users.terms_version / terms_accepted_at, migration_v43). The notice never
// blocks the account; this only stores the answer. A page opened before a newer version shipped gets a 409, so the
// person reloads and sees the latest Terms first.
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return json({ error: 'Not signed in.' }, { status: 401, headers: NO_STORE });

  let body;
  try { body = await context.request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request body.' }, { status: 400, headers: NO_STORE });

  if (body.version !== CURRENT_TERMS_VERSION) {
    return json({ error: 'The Terms changed again. Reload the page to see the latest.', code: 'terms_changed' },
      { status: 409, headers: NO_STORE });
  }

  await context.env.DB.prepare("UPDATE users SET terms_version = ?, terms_accepted_at = datetime('now') WHERE id = ?")
    .bind(CURRENT_TERMS_VERSION, user.id).run();
  return json({ ok: true, termsVersion: CURRENT_TERMS_VERSION }, { headers: NO_STORE });
}
