import { disputesGone } from '../../../_lib/disputes.js';

// Disputes have been replaced by "Report a rules problem" (POST /api/reports); see functions/_lib/disputes.js.
export async function onRequestPost() {
  return disputesGone();
}
