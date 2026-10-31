// A live badge an agent can put on their own website or email signature: /badge/<agentId>.svg, linking back to their
// Amico Haus profile. Shows the same measured stats as their Brag Card (functions/_lib/brag.js), always with their
// name, DRE number and brokerage, and the date. Plain SVG text only (no scripts, no external images).
import { fetchBragStats } from '../_lib/brag.js';
import { escapeHtml } from '../_lib/util.js';

// Word-wraps to about `width` characters (SVG text doesn't wrap by itself).
function wrapChars(text, width) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(' ')) {
    if (cur && (cur + ' ' + w).length > width) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function line(text, y, size, weight, fill) {
  return `<text x="16" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeHtml(text)}</text>`;
}

export async function onRequestGet(context) {
  const match = /^(\d+)\.svg$/.exec(String(context.params.file || ''));
  if (!match) return new Response('Not found', { status: 404 });
  const brag = await fetchBragStats(context.env.DB, Number(match[1]));
  if (!brag) return new Response('Not found', { status: 404 });

  // Nothing that identifies the licensee is ever cut: long names and brokerages wrap and the badge grows.
  const stats = [...(brag.isPlatformOperator ? ['Platform operator: runs Amico Haus'] : []), ...brag.items].slice(0, 2);
  const nameLines = wrapChars(brag.name, 36);
  const statLines = stats.flatMap(s => wrapChars(s, 54));
  const creditLines = [...wrapChars([brag.licenseNumber ? `DRE #${brag.licenseNumber}` : '', brag.brokerage].filter(Boolean).join(' · '), 72), `From Amico Haus records, as of ${brag.asOf}`];
  const parts = [line('AMICO HAUS', 24, 13, 700, '#cf9f5e')];
  let y = 46;
  for (const l of nameLines) { parts.push(line(l, y, 18, 700, '#ffffff')); y += 22; }
  for (const l of statLines) { parts.push(line(l, y, 13, 400, '#e9e7e0')); y += 19; }
  y += 4;
  for (const l of creditLines) { parts.push(line(l, y, 10, 400, '#9aa5b1')); y += 14; }
  const height = y + 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="${height}" viewBox="0 0 440 ${height}" role="img" aria-label="${escapeHtml(`${brag.name} on Amico Haus`)}">
<rect width="440" height="${height}" rx="12" fill="#182430"/>
${parts.join('\n')}
</svg>`;
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      // Shown on other sites as an image; nothing in it may run.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
