import { json } from '../../../_lib/util.js';

// "Express Interest" / "Interested Investors" is gone (Rudy 11.04): FinderMine posts are projects looking for a
// builder, partner or co-buyer, and people reach the poster through Amico Haus messages. Old rows stay; nothing
// reads or writes them.
export async function onRequestPost() {
  return json({ error: 'Send the poster a message through Amico Haus instead.', code: 'gone' }, { status: 410 });
}
