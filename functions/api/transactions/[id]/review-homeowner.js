import { json } from '../../../_lib/util.js';

// Homeowner ratings are no longer part of Amico Haus (Rudy 11.04). The table stays; nothing reads or writes it.
export async function onRequestPost() {
  return json({ error: 'Homeowner ratings are no longer part of Amico Haus.', code: 'gone' }, { status: 410 });
}
