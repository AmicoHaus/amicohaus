import { unsubscribeToken } from '../../_lib/scorecard.js';
import { escapeHtml } from '../../_lib/util.js';

// Unsubscribe from the Monday scorecard email (the link in every email). The token is an HMAC of the agent's id, so a
// link can only turn off that one agent's email. Opening the link shows a page with one button; the button does it.
// (Email security scanners open links on their own, so a plain visit must never unsubscribe anyone.)
function page(title, message, form = '') {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Amico Haus</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/styles.css"></head>
<body><div id="app"><main class="prose"><p class="eyebrow">Amico Haus</p><h1>${title}</h1><p>${message}</p>${form}
<p><a class="btn btn-ghost" href="/app#become-agent">Open your dashboard</a></p></main></div></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

async function checked(context, userId, token) {
  return Number.isInteger(userId) && userId > 0 && token.length === 32 && token === await unsubscribeToken(context.env, userId);
}

const BAD_LINK = () => page("That link didn't work", 'You can turn the Monday scorecard off from your agent dashboard instead.');

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const userId = Number(url.searchParams.get('u'));
  const token = String(url.searchParams.get('t') || '');
  if (!(await checked(context, userId, token))) return BAD_LINK();
  return page('Stop the Monday scorecard?', 'You can turn it back on any time from your agent dashboard.',
    `<form method="post" action="/api/agents/scorecard-unsubscribe?u=${userId}&amp;t=${escapeHtml(token)}"><button type="submit" class="btn btn-primary">Stop the Monday email</button></form>`);
}

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  const userId = Number(url.searchParams.get('u'));
  const token = String(url.searchParams.get('t') || '');
  if (!(await checked(context, userId, token))) return BAD_LINK();
  await context.env.DB.prepare('UPDATE agent_profiles SET scorecard_opt_out = 1 WHERE user_id = ?').bind(userId).run();
  return page("You won't get the Monday scorecard anymore", 'You can turn it back on any time from your agent dashboard.');
}
