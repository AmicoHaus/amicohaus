// Where a signup or contact-form lead came from: the campaign tags and ad click ids from the link they
// first arrived on, plus the landing page and the referring site (see captureAttribution in client.js).
// Stored as a small JSON string on the user or lead row so ad results can be read back later; nothing
// here is shown publicly.
import { clampString } from './util.js';

const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'landing', 'referrer', 'in_app'];
const IN_APP_NAMES = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };

// Keeps only the known keys, each a short string. Returns the JSON to store, or null when there's nothing.
export function sanitizeAttribution(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of KEYS) {
    // Line breaks and other control characters are flattened: these values end up in plain-text emails.
    const value = clampString(String(raw[key] ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' '), 200);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

// One readable line for an email to Rudy, e.g. "tiktok / video · campaign: fall-launch · landed on /signup".
export function describeAttribution(json) {
  let a;
  try { a = JSON.parse(json || 'null'); } catch { a = null; }
  if (!a) return 'Unknown (no tracking info)';
  const parts = [];
  if (a.utm_source || a.utm_medium) parts.push([a.utm_source, a.utm_medium].filter(Boolean).join(' / '));
  if (a.utm_campaign) parts.push(`campaign: ${a.utm_campaign}`);
  if (a.utm_content) parts.push(`ad: ${a.utm_content}`);
  // Meta adds fbclid to ordinary (unpaid) link clicks too, so it only counts as an ad when the campaign
  // tags say paid; Google's gclid and TikTok's ttclid only come from ads.
  const paid = /^(.*cp.*|ppc|retargeting|paid.*|ads?)$/i.test(a.utm_medium || ''); // GA4's "paid" mediums
  const clicks = [a.fbclid && (paid ? 'Facebook/Instagram ad click' : 'Facebook/Instagram link click'), a.gclid && 'Google ad click', a.ttclid && 'TikTok ad click'].filter(Boolean);
  parts.push(...clicks);
  if (a.referrer) parts.push(`from ${a.referrer}`);
  if (a.landing) parts.push(`landed on ${a.landing}`);
  if (IN_APP_NAMES[a.in_app]) parts.push(`inside ${IN_APP_NAMES[a.in_app]}'s app browser`);
  return parts.join(' · ') || 'Direct visit';
}
