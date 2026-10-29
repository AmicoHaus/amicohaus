import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';

// One presentation file per agent per pre-listing, part of their price opinion: a PDF, PowerPoint or Word file
// that backs up the price they suggest. Only the homeowner and the agent who uploaded it can download it, and it
// is always sent as a download (never shown inline), with its type decided by the file's own first bytes rather
// than by the name or the browser's claim.
const MAX_DECK_BYTES = 20 * 1024 * 1024; // 20MB
const TOO_BIG = 'The file must be under 20MB. Saving a PowerPoint as a PDF usually makes it much smaller.';

const TYPES = {
  pdf: { mime: 'application/pdf', magic: 'pdf' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'zip' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' },
  ppt: { mime: 'application/vnd.ms-powerpoint', magic: 'ole' },
  doc: { mime: 'application/msword', magic: 'ole' },
};
const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  zip: [0x50, 0x4b, 0x03, 0x04], // PK.. (pptx/docx are zip packages)
  ole: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // older .ppt/.doc
};

function startsWith(bytes, sig) {
  return sig.every((b, i) => bytes[i] === b);
}

// Letters, numbers, spaces and . _ ( ) - only, so the name is safe in a download header and on any computer.
function safeFileName(name, ext) {
  const base = String(name || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9 ._()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'presentation'}.${ext}`;
}

async function loadPreListing(db, id) {
  return db.prepare('SELECT user_id, status FROM pre_listings WHERE id = ?').bind(id).first();
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can attach a presentation.');

  const preListing = await loadPreListing(db, id);
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id === user.id) return forbidden("You can't weigh in on your own pre-listing.");
  if (preListing.status !== 'open') return badRequest('This pre-listing is closed, so it is no longer taking price opinions.');

  const existing = await db.prepare('SELECT deck_r2_key FROM pre_listing_price_opinions WHERE pre_listing_id = ? AND agent_user_id = ?').bind(id, user.id).first();

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'File storage is not configured yet.' }, { status: 503 });

  // Refused before the body is read, so a huge file gets the friendly message instead of a memory error.
  const declared = Number(context.request.headers.get('Content-Length')) || 0;
  if (declared > MAX_DECK_BYTES + 64 * 1024) return badRequest(TOO_BIG);

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "file" field.'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return badRequest('No file provided.');
  if (file.size > MAX_DECK_BYTES) return badRequest(TOO_BIG);

  const ext = String(file.name || '').split('.').pop().toLowerCase();
  const type = TYPES[ext];
  if (!type) return badRequest('Attach a PDF, PowerPoint (.pptx or .ppt) or Word (.docx or .doc) file.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!startsWith(bytes, MAGIC[type.magic])) return badRequest("That file doesn't look like a real PDF, PowerPoint or Word file.");

  const key = `pre-listing-decks/${id}/${user.id}/${crypto.randomUUID()}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: type.mime } });
  const name = safeFileName(file.name, ext);
  await db.prepare(
    `INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, deck_r2_key, deck_name, deck_type, deck_size)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(pre_listing_id, agent_user_id) DO UPDATE SET deck_r2_key = excluded.deck_r2_key, deck_name = excluded.deck_name,
       deck_type = excluded.deck_type, deck_size = excluded.deck_size, updated_at = datetime('now')`
  ).bind(id, user.id, key, name, type.mime, bytes.length).run();
  if (existing && existing.deck_r2_key) {
    try { await bucket.delete(existing.deck_r2_key); } catch (err) { console.log(`[old deck delete failed] ${err.message}`); }
  }
  return json({ deck: { name, size: bytes.length } }, { status: 201 });
}

// ?agent=<id> picks whose file (the homeowner viewing several); an agent can only ever get their own. Nobody else,
// admins included, which is what lets the form promise agents that only the homeowner sees it.
export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const preListing = await loadPreListing(db, id);
  if (!preListing) return notFound('Pre-listing not found.');
  const isOwner = preListing.user_id === user.id;
  const agentId = Number(new URL(context.request.url).searchParams.get('agent')) || user.id;
  if (!isOwner && agentId !== user.id) return forbidden();

  const row = await db.prepare(
    'SELECT deck_r2_key, deck_name, deck_type FROM pre_listing_price_opinions WHERE pre_listing_id = ? AND agent_user_id = ?'
  ).bind(id, agentId).first();
  if (!row || !row.deck_r2_key) return notFound('No presentation attached.');
  const bucket = context.env.PHOTOS;
  const object = bucket ? await bucket.get(row.deck_r2_key) : null;
  if (!object) return notFound('No presentation attached.');

  return new Response(object.body, {
    headers: {
      'Content-Type': row.deck_type,
      'Content-Disposition': `attachment; filename="${row.deck_name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const row = await db.prepare('SELECT id, deck_r2_key FROM pre_listing_price_opinions WHERE pre_listing_id = ? AND agent_user_id = ?').bind(id, user.id).first();
  if (!row || !row.deck_r2_key) return notFound('No presentation attached.');
  await db.prepare("UPDATE pre_listing_price_opinions SET deck_r2_key = NULL, deck_name = NULL, deck_type = NULL, deck_size = NULL, updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
  try { if (context.env.PHOTOS) await context.env.PHOTOS.delete(row.deck_r2_key); } catch (err) { console.log(`[deck delete failed] ${err.message}`); }
  return json({ ok: true });
}
