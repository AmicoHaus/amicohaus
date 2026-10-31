/* Amico Haus — approved agents' growth tools on their dashboard (loaded before main.js, which calls
   loadAgentGrowth() from loadAgentStatus): the past-client review link (Bring Your Reviews), the Brag Card + live
   badge built from Amico Haus records (functions/_lib/brag.js), "Your week" (the Monday scorecard,
   functions/_lib/scorecard.js) and on-duty hours (Farm Radar, functions/_lib/agentDuty.js). */

const EARLIEST_REVIEW_YEAR = 1980;

function loadAgentGrowth() {
  loadPastClientInvite();
  loadBragPanel();
  loadScorecardPanel();
  loadDutyPanel();
}

// ---- Your week (the Monday scorecard) ----
async function loadScorecardPanel() {
  const el = document.getElementById('scorecardPanel');
  if (!el) return;
  try {
    const { scorecard: c } = await apiGet('/api/agents/scorecard');
    const n = c.counts;
    const row = (label, value) => `<div class="mini-block"><span class="label">${escapeHtml(label)}</span>${escapeHtml(String(value))}</div>`;
    el.innerHTML = `
      <p class="section-sub">Your last 7 days on Amico Haus. The same summary can come to your inbox every Monday morning.</p>
      <div class="mini-two">
        ${row('Proposals sent', n.proposals)}
        ${row('Price opinions', n.opinions)}
        ${row('Interview requests', n.interviews)}
        ${row('Hires', n.hires)}
        ${row('New pre-listings near you', `${n.newNearby} (you weighed in on ${n.answered})`)}
        ${c.speed ? row('Your typical proposal', `${c.speed.mine}${c.speed.area ? `; agents who serve your area: ${c.speed.area}` : ''}`) : ''}
      </div>
      <p class="inline-note"><strong>One next step:</strong> ${escapeHtml(c.nextStep)}</p>
      <label class="checkbox-row"><input type="checkbox" id="scorecardEmailToggle"${c.optOut ? '' : ' checked'}><span>Email me this every Monday morning</span></label>`;
  } catch (err) { el.innerHTML = `<p class="tiny">${escapeHtml(err.message)}</p>`; }
}

// ---- On-duty hours (Farm Radar) ----
const DUTY_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function loadDutyPanel() {
  const el = document.getElementById('dutyPanel');
  if (!el) return;
  try {
    const { duty, description, onDutyNow } = await apiGet('/api/agents/duty');
    const days = duty ? duty.days : [1, 2, 3, 4, 5];
    el.innerHTML = `
      <p class="section-sub">New-request emails that arrive outside these hours wait until you're back on duty. In-app alerts always arrive right away, at the same moment as every other agent's. Homeowners see how many agents who serve their ZIP are on duty right now.</p>
      ${duty ? `<p class="tiny">${onDutyNow ? '🟢 You are on duty now.' : 'You are off duty right now.'} Your hours: ${escapeHtml(description)}.</p>` : '<p class="tiny">No hours set: emails reach you any time.</p>'}
      <div class="duty-days">${DUTY_DAY_LABELS.map((label, i) => `<label class="checkbox-row"><input type="checkbox" class="duty-day" value="${i}"${days.includes(i) ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>
      <div class="form-row two-col">
        <div class="field"><label for="dutyStart">From (Pacific)</label><input type="time" id="dutyStart" value="${escapeHtml(duty ? duty.start : '08:00')}"></div>
        <div class="field"><label for="dutyEnd">Until</label><input type="time" id="dutyEnd" value="${escapeHtml(duty ? duty.end : '18:00')}"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-sm" data-growth-action="save-duty">Save my hours</button>
        ${duty ? '<button type="button" class="btn btn-ghost btn-sm" data-growth-action="clear-duty">Clear my hours</button>' : ''}
      </div>`;
  } catch (err) { el.innerHTML = `<p class="tiny">${escapeHtml(err.message)}</p>`; }
}

// ---- Bring Your Reviews ----
async function loadPastClientInvite(showForm = false) {
  const el = document.getElementById('pastClientInvitePanel');
  if (!el) return;
  try {
    el.innerHTML = pastClientInviteHtml(await apiGet('/api/agents/review-invite'), showForm);
  } catch (err) { el.innerHTML = `<p class="tiny">${escapeHtml(err.message)}</p>`; }
}

function pastClientInviteHtml(inv, showForm) {
  const thisYear = new Date().getFullYear();
  const yearOptions = (selected) => Array.from({ length: thisYear - EARLIEST_REVIEW_YEAR + 1 }, (_, i) => thisYear - i)
    .map(y => `<option value="${y}"${y === selected ? ' selected' : ''}>${y}</option>`).join('');
  const counts = inv.reviewCount ? `<p class="tiny">${inv.reviewCount} past-client review${inv.reviewCount === 1 ? '' : 's'} so far${inv.avgRating ? `, averaging ★ ${inv.avgRating}` : ''}.</p>` : '';
  const form = `
    <div class="form-row two-col">
      <div class="field"><label for="reviewFromYear">Clients from</label><select id="reviewFromYear">${yearOptions(inv.fromYear || thisYear - 3)}</select></div>
      <div class="field"><label for="reviewToYear">through</label><select id="reviewToYear">${yearOptions(inv.toYear || thisYear)}</select></div>
    </div>
    <label class="checkbox-row"><input type="checkbox" id="reviewAttest"><span>I'll send this link to every client I helped in these years, not only the happiest ones, and I won't offer anything in return for a review.</span></label>
    <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-growth-action="make-review-link">${inv.link ? 'Make a new link' : 'Make my review link'}</button></div>`;
  const intro = '<p class="section-sub">So your profile doesn\'t start at zero: send past clients a link from your own email or phone. Their reviews show on your profile under "Past clients, outside Amico Haus," apart from reviews from homeowners who hire you here, and your profile says which years you picked. You can\'t hide or remove them, so send it to everyone from those years.</p>';
  if (!inv.link) return `${intro}${counts}${form}`;
  return `${intro}
    <div class="field"><label for="pastClientLink">Your past-client review link (${escapeHtml(String(inv.fromYear))}${inv.toYear !== inv.fromYear ? ` to ${escapeHtml(String(inv.toYear))}` : ''})</label><input type="text" id="pastClientLink" readonly value="${escapeHtml(location.origin + inv.link)}"></div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-growth-action="copy-review-link">Copy link</button>
      <button type="button" class="btn btn-ghost btn-sm" data-growth-action="new-review-period">Change the years</button>
      <button type="button" class="btn btn-ghost btn-sm" data-growth-action="stop-review-link">Turn the link off</button>
    </div>
    ${counts}
    ${showForm ? form : ''}`;
}

// ---- Brag Card + badge ----
let currentBrag = null;

async function loadBragPanel() {
  const el = document.getElementById('bragPanel');
  if (!el) return;
  try {
    const { brag } = await apiGet('/api/agents/brag');
    currentBrag = brag;
    el.innerHTML = bragPanelHtml(brag);
  } catch (err) { el.innerHTML = `<p class="tiny">${escapeHtml(err.message)}</p>`; }
}

function bragPanelHtml(brag) {
  if (!brag.items.length) {
    return '<p class="section-sub">Your Brag Card and website badge unlock with your first Amico Haus record: a founding-agent spot, a hire, a finalist spot, 3 reviews from homeowners who hired you, or 3 proposals (for your proposal speed).</p>';
  }
  const badgeUrl = `${location.origin}/badge/${brag.userId}.svg`;
  const profileUrl = `${location.origin}/profile/${brag.userId}`;
  const embed = `<a href="${profileUrl}"><img src="${badgeUrl}" alt="${escapeHtml(`${brag.name} on Amico Haus`)}" width="440"></a>`;
  return `
    <p class="section-sub">Share what Amico Haus has recorded about your work here: real numbers with enough behind them, dated, with your name, DRE number and brokerage on every one. Past-client reviews stay on your profile and aren't on the card, since Amico Haus hasn't verified them.</p>
    ${brag.isPlatformOperator ? '<p class="tiny">Your card and badge also say "Platform operator: runs Amico Haus," as on all your proposals.</p>' : ''}
    <ul class="brag-list">${brag.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-growth-action="brag-card">Download my Brag Card</button></div>
    <p class="tiny"><span class="label">Live badge</span> for your website or email signature. It updates as your stats do.</p>
    <img src="/badge/${brag.userId}.svg" alt="Your Amico Haus badge" class="brag-badge">
    <div class="field"><label for="badgeEmbed">Badge code</label><textarea id="badgeEmbed" readonly rows="3">${escapeHtml(embed)}</textarea></div>
    <div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-growth-action="copy-badge">Copy badge code</button></div>`;
}

function bragWrap(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function downloadBragCard(brag) {
  const S = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#182430');
  bg.addColorStop(1, '#22303d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  const font = (size, weight = 600) => `${weight} ${size}px Georgia, 'Times New Roman', serif`;
  const x = 96;
  const maxW = S - 2 * x;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#cf9f5e';
  ctx.font = font(40, 700);
  ctx.fillText('AMICO HAUS', x, 150);
  // Footer first (bottom up), so the name and stats know how much room they have. The licensee's name, DRE number
  // and brokerage are never cut: long ones wrap, and the name steps down in size to fit.
  ctx.font = font(30, 400);
  const footer = [
    `From Amico Haus records, as of ${brag.asOf}`,
    ...bragWrap(ctx, [brag.licenseNumber ? `DRE #${brag.licenseNumber}` : '', brag.brokerage].filter(Boolean).join(' · '), maxW),
  ];
  let fy = S - 80;
  ctx.fillStyle = '#cf9f5e';
  ctx.fillText(`amicohaus.com/profile/${brag.userId}`, x, fy, maxW);
  ctx.fillStyle = '#9aa5b1';
  for (const l of footer.slice().reverse()) { fy -= 44; ctx.fillText(l, x, fy, maxW); }
  const footerTop = fy - 50;

  let nameSize = 84;
  ctx.font = font(nameSize, 700);
  while (bragWrap(ctx, brag.name, maxW).length > 2 && nameSize > 52) { nameSize -= 4; ctx.font = font(nameSize, 700); }
  ctx.fillStyle = '#ffffff';
  let y = 250;
  for (const l of bragWrap(ctx, brag.name, maxW)) { ctx.fillText(l, x, y, maxW); y += nameSize + 12; }
  y += 30;
  ctx.font = font(44, 400);
  for (const item of [...(brag.isPlatformOperator ? ['Platform operator: runs Amico Haus'] : []), ...brag.items].slice(0, 4)) {
    const lines = bragWrap(ctx, item, maxW - 50);
    if (y + (lines.length - 1) * 56 > footerTop) break;
    ctx.fillStyle = '#cf9f5e';
    ctx.fillText('•', x, y);
    ctx.fillStyle = '#e9e7e0';
    for (const l of lines) { ctx.fillText(l, x + 50, y, maxW - 50); y += 56; }
    y += 18;
  }

  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error("Your browser couldn't make the image.");
  const file = new File([blob], 'amico-haus-brag-card.png', { type: 'image/png' });
  // On a phone or tablet the share sheet is the natural way to post it; on a computer the button saves the file.
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `${brag.name} on Amico Haus` }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Brag Card saved to your downloads.');
}

async function copyField(id, message) {
  const input = document.getElementById(id);
  if (!input) return;
  try { await navigator.clipboard.writeText(input.value); toast(message); } catch { input.select(); toast('Select and copy it above.'); }
}

(function wireAgentGrowth() {
  document.addEventListener('change', async (e) => {
    if (e.target.id !== 'scorecardEmailToggle') return;
    const box = e.target;
    box.disabled = true;
    try {
      await apiPut('/api/agents/scorecard', { optOut: !box.checked });
      toast(box.checked ? "You'll get your week every Monday morning." : 'Monday emails are off.');
    } catch (err) { box.checked = !box.checked; toast(err.message); } finally { box.disabled = false; }
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-growth-action]');
    if (!btn) return;
    const action = btn.dataset.growthAction;
    btn.disabled = true;
    try {
      if (action === 'make-review-link') {
        const fromYear = Number(document.getElementById('reviewFromYear').value);
        const toYear = Number(document.getElementById('reviewToYear').value);
        await apiPut('/api/agents/review-invite', { fromYear, toYear, attest: document.getElementById('reviewAttest').checked });
        toast('Your review link is ready. Any earlier link stops working.');
        loadPastClientInvite();
      } else if (action === 'new-review-period') {
        loadPastClientInvite(true);
      } else if (action === 'stop-review-link') {
        if (!confirm('Turn off your past-client review link? Reviews already left stay on your profile.')) return;
        await apiDelete('/api/agents/review-invite');
        loadPastClientInvite();
      } else if (action === 'copy-review-link') {
        await copyField('pastClientLink', 'Review link copied. Send it from your own email or phone.');
      } else if (action === 'copy-badge') {
        await copyField('badgeEmbed', 'Badge code copied.');
      } else if (action === 'brag-card' && currentBrag) {
        await downloadBragCard(currentBrag);
      } else if (action === 'save-duty') {
        const days = [...document.querySelectorAll('.duty-day:checked')].map(c => Number(c.value));
        await apiPut('/api/agents/duty', { days, start: document.getElementById('dutyStart').value, end: document.getElementById('dutyEnd').value });
        toast('On-duty hours saved.');
        loadDutyPanel();
      } else if (action === 'clear-duty') {
        await apiPut('/api/agents/duty', { clear: true });
        toast('Hours cleared. Emails reach you any time.');
        loadDutyPanel();
      }
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
})();
