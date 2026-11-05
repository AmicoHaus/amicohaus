import { json } from '../../../_lib/util.js';

// Agents rating homeowners is no longer part of Amico Haus (Rudy 11.04): the site doesn't score people. Nothing reads
// or writes homeowner_reviews any more; the table stays (it never had rows in production).
export async function onRequestPost() {
  return json({ error: 'Homeowner ratings are no longer part of Amico Haus.', code: 'gone' }, { status: 410 });
}
