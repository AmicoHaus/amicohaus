import { sellerReportUnsubscribeToken } from '../../_lib/sellerReport.js';
import { escapeHtml } from '../../_lib/util.js';
import { withSecurityHeaders } from '../../_lib/withSecurityHeaders.js';

// Stop the Monday seller report (the link in every one). The token is an HMAC of the person's id, so a link can only
// turn off that one person's email, and no login is needed. Opening the link shows a page with one button; the button
// does it. (Email security scanners open links on their own, so a plain visit must never unsubscribe anyone.)
function page(title, message, form = '') {
  return withSecurityHeaders(new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Amico Haus</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/styles.css"></head>
<body><div id="app"><main class="prose"><p class="eyebrow">Amico Haus</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${form}
<p><a class="btn btn-ghost" href="/account-security">Account settings</a></p></main></div></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  }));
}

async function checked(context, userId, token) {
  return Number.isInteger(userId) && userId > 0 && token.length === 32 && token === await sellerReportUnsubscribeToken(context.env, userId);
}

const BAD_LINK = () => page("That link didn't work", "This link didn't work. You can turn the Monday email off in your account settings.");

function linkParts(context) {
  const url = new URL(context.request.url);
  return { userId: Number(url.searchParams.get('u')), token: String(url.searchParams.get('t') || '') };
}

export async function onRequestGet(context) {
  const { userId, token } = linkParts(context);
  if (!(await checked(context, userId, token))) return BAD_LINK();
  return page('Stop the Monday email?', "You won't get the Monday summary about your home anymore. You can turn it back on in your account settings.",
    `<form method="post" action="/api/account/seller-report-unsubscribe?u=${userId}&amp;t=${escapeHtml(token)}"><button type="submit" class="btn btn-primary">Stop the Monday email</button></form>`);
}

export async function onRequestPost(context) {
  const { userId, token } = linkParts(context);
  if (!(await checked(context, userId, token))) return BAD_LINK();
  await context.env.DB.prepare('UPDATE users SET seller_report_opt_out = 1 WHERE id = ?').bind(userId).run();
  return page('The Monday email is off', 'Done. The Monday email about your home is off.');
}
