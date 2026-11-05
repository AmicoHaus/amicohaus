import { disputesGone } from '../../../_lib/disputes.js';

// The admin dispute screen is read-only history now: no verdicts (Mark Resolved / Dismiss) and no new notes.
// See functions/_lib/disputes.js.
export async function onRequestPut() {
  return disputesGone();
}
