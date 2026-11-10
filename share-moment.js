/* Amico Haus — Share Your Moment: Reveal Mode (a full-screen flip of the proposals that opened together, made for the
   homeowner's own screen recording) and the Hired! story slides. Loaded after decision-night.js and before main.js;
   demo.html loads it too and only calls openRevealMode. Only the owner's own counts are ever shown: agents are
   Agent A, B, C by arrival, with no names, photos, brokerages, fees, prices, proposal text, address or ZIP.
   openedTogether, liveBids and decisionView come from decision-night.js and are read only when a button is drawn
   or clicked, never at load. */

// The repost OK, word for word (bump MOMENT_CONSENT_VERSION in functions/_lib/moment.js when this changes).
const MOMENT_CONSENT_TEXT = {
  reveal: 'Rudy Flores may repost my video or screenshots of this Reveal Mode on Amico Haus and his social accounts. Everyone shown or heard in my recording is OK with that. No payment or reward. I can take this back anytime here, and he\'ll remove his reposts.',
  hired: 'Rudy Flores may repost my video or screenshots of this Hired! story on Amico Haus and his social accounts. Everyone shown or heard in my recording is OK with that. No payment or reward. I can take this back anytime here, and he\'ll remove his reposts.',
};
const MOMENT_TAGLINE = "Amico Haus: the real estate marketplace of tomorrow! Everything that's missing from the real estate market for the homeowner!";
const MOMENT_PRESENTED = 'Presented by Rudy Flores, Realtor® · DRE #02257808';
const MOMENT_BROKER = 'Coldwell Banker West';
const MOMENT_OPERATOR_LINE = 'The agent I picked runs Amico Haus';
const MOMENT_FALLBACK_LINK = 'https://amicohaus.com/signup?as=homeowner';

// The home the moment buttons were last drawn for.
const momentView = { p: null, bids: [] };

const MOMENT_plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "Agent A" ... "Agent Z", then "Agent 27" and on.
function MOMENT_letter(i) {
  return i < 26 ? `Agent ${String.fromCharCode(65 + i)}` : `Agent ${i + 1}`;
}

// The owner's own count: the proposals that opened together on Decision Night, else every live one.
function MOMENT_count(p, bids) {
  return p.decisionNight ? openedTogether(bids).length : liveBids(bids).length;
}

function MOMENT_pickLine(p) {
  const m = p.moment || {};
  const k = Number(m.interviewsDone) || 0;
  const base = k > 0 ? `I interviewed ${k} and picked 1` : 'I picked my agent';
  return typeof m.daysToHire === 'number' ? `${base} in ${MOMENT_plural(m.daysToHire, 'day', 'days')}` : base;
}

function MOMENT_consentHtml(p, moment) {
  const id = moment === 'reveal' ? 'momentRepostReveal' : 'momentRepostHired';
  const on = !!(p.moment && p.moment.repost && p.moment.repost[moment]);
  return `<label class="checkbox-row moment-consent" for="${id}"><input type="checkbox" id="${id}" data-moment-repost="${moment}"${on ? ' checked' : ''}><span>${escapeHtml(MOMENT_CONSENT_TEXT[moment])}</span></label>
    <p class="tiny">You send him your recording yourself. Amico Haus never records your screen.</p>`;
}

// Reveal Mode button (owner, after Decision Night, 2 or more proposals opened together).
function momentButtonsHtml(p, bids) {
  momentView.p = p;
  momentView.bids = bids || [];
  if (!p || !p.decisionNight || p.decisionNight.sealed || openedTogether(bids).length < 2) return '';
  return `
    <div class="moment-actions">
      <p><button type="button" class="btn btn-primary btn-sm" data-moment-action="reveal">▶ Reveal Mode</button>
      <span class="tiny">Full screen, made for screen recording: each proposal flips open one at a time. Agents show as Agent A, B, C, with no names, fees or prices.</span></p>
      ${MOMENT_consentHtml(p, 'reveal')}
    </div>`;
}

// Hired! story (owner, after hiring).
function momentStoryHtml(p, bids) {
  momentView.p = p;
  momentView.bids = bids || [];
  if (!p || p.status !== 'awarded') return '';
  const count = MOMENT_count(p, bids);
  const countLine = `${MOMENT_plural(count, 'agent', 'agents')} sent me proposals`;
  return `
    <div class="moment-story">
      <p><strong>Share your moment</strong> <span class="tiny">(optional)</span></p>
      <p class="tiny">A few slides for your stories: how many agents sent proposals, your pick, and a link for friends. No names, fees, prices or address.</p>
      <div class="moment-slide-toggles">
        ${count >= 1 ? `<label class="checkbox-row" for="momentSlideCount"><input type="checkbox" id="momentSlideCount" checked><span>"${escapeHtml(countLine)}"</span></label>` : ''}
        <label class="checkbox-row" for="momentSlidePick"><input type="checkbox" id="momentSlidePick" checked><span>"${escapeHtml(MOMENT_pickLine(p))}"</span></label>
        <label class="checkbox-row" for="momentSlideTurn"><input type="checkbox" id="momentSlideTurn" checked><span>"Your turn"</span></label>
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-moment-action="story">Make my Hired! story</button>
      ${MOMENT_consentHtml(p, 'hired')}
    </div>`;
}

// ---- Reveal Mode: full screen, one card flips per tap / Space / → ----
// cards: [{ letter: 'Agent A', reel: bool }] in arrival order. Nothing else from a proposal is ever passed in.
function openRevealMode(cards, opts = {}) {
  const list = (cards || []).map((c, i) => ({ letter: String(c.letter || MOMENT_letter(i)), reel: !!c.reel }));
  if (!list.length || document.querySelector('.moment-overlay')) return;
  const where = [opts.city, opts.state].filter(Boolean).join(', ');
  const trigger = document.activeElement;
  let flipped = 0;
  let sound = false;
  let audio = null;

  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const overlay = make('div', 'moment-overlay');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Reveal Mode');
  const stage = make('div', 'moment-stage');
  // Everything readable sits inside the safe area of a 1080x1920 frame (x 60-960, y 220-1480; styles.css).
  const safe = make('div');
  if (opts.sample) safe.appendChild(make('span', 'moment-sample', 'Sample data'));
  safe.appendChild(make('h2', '', 'My Decision Night'));
  if (where) safe.appendChild(make('p', '', where));
  const row = make('div');
  row.setAttribute('role', 'list');
  const cardEls = list.map((c) => {
    const card = make('div', 'moment-card');
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', 'Proposal, not opened yet');
    const back = make('span', '', '?');
    back.setAttribute('aria-hidden', 'true');
    const front = make('div');
    front.appendChild(make('span', 'moment-letter', c.letter));
    front.appendChild(make('span', 'moment-caption', c.reel ? 'Proposal opened with a pitch reel' : 'Proposal opened'));
    card.append(back, front);
    row.appendChild(card);
    return card;
  });
  safe.appendChild(row);
  const final = make('div', 'moment-final');
  final.hidden = true;
  final.append(
    make('p', '', `${MOMENT_plural(list.length, 'agent', 'agents')} sent me proposals`),
    make('strong', '', 'AMICO HAUS'),
    make('span', '', MOMENT_TAGLINE),
  );
  safe.appendChild(final);
  const foot = make('footer');
  foot.append(make('span', '', MOMENT_PRESENTED), make('span', '', MOMENT_BROKER));
  safe.appendChild(foot);
  stage.appendChild(safe);

  const controls = make('div', 'moment-controls');
  const nextBtn = make('button', 'btn btn-primary btn-sm', 'Next');
  nextBtn.type = 'button';
  nextBtn.dataset.momentAction = 'next';
  const soundBtn = make('button', 'btn btn-ghost btn-sm', 'Sound');
  soundBtn.type = 'button';
  soundBtn.dataset.momentAction = 'sound';
  soundBtn.setAttribute('aria-pressed', 'false');
  const closeBtn = make('button', 'btn btn-ghost btn-sm', 'Close');
  closeBtn.type = 'button';
  closeBtn.dataset.momentAction = 'close';
  controls.append(nextBtn, soundBtn, closeBtn);
  const status = make('p', 'tiny');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  controls.appendChild(status);
  overlay.append(stage, controls);
  document.body.appendChild(overlay);
  document.body.classList.add('reel-open');

  // A short synthesized drum tick per flip (no files). Off until the owner turns it on.
  const tick = () => {
    if (!sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = audio || new AC();
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.14);
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch { /* no sound is fine */ }
  };

  const flipNext = () => {
    if (flipped >= cardEls.length) return;
    const card = cardEls[flipped];
    card.classList.add('moment-card-flipped');
    const c = list[flipped];
    card.setAttribute('aria-label', `${c.letter}: proposal opened${c.reel ? ' with a pitch reel' : ''}`);
    flipped++;
    tick();
    status.textContent = `${c.letter}: proposal opened.`;
    if (flipped === cardEls.length) {
      final.hidden = false;
      nextBtn.disabled = true;
      closeBtn.focus();
    }
  };

  const close = () => {
    overlay.remove();
    document.body.classList.remove('reel-open');
    document.removeEventListener('keydown', onKey, true);
    if (audio && audio.close) audio.close().catch(() => {});
    if (trigger && document.body.contains(trigger) && trigger.focus) trigger.focus();
  };
  // Captured before main.js's own Escape handler, which would otherwise also leave the pre-listing.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.repeat) return;
    if (e.key === 'ArrowRight' || ((e.key === ' ' || e.key === 'Spacebar') && !(e.target && e.target.closest && e.target.closest('button')))) {
      e.preventDefault();
      flipNext();
    }
  };
  document.addEventListener('keydown', onKey, true);

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-moment-action]');
    if (btn) {
      const what = btn.dataset.momentAction;
      if (what === 'next') flipNext();
      else if (what === 'close') close();
      else if (what === 'sound') {
        sound = !sound;
        soundBtn.setAttribute('aria-pressed', sound ? 'true' : 'false');
      }
      return;
    }
    if (e.target.closest('.moment-stage')) flipNext();
  });
  nextBtn.focus();
}

// ---- Hired! story slides (1080x1920 PNG, same look as the Decision Night share card) ----
function MOMENT_wrapText(ctx, text, maxWidth) {
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

// One slide. Everything stays inside the area TikTok/Reels/Stories leave uncovered (x 60-960, y 220-1480).
function MOMENT_drawSlide(ctx, { headline, sub, operator }) {
  const W = 1080;
  const H = 1920;
  const cx = 510;
  const maxW = 840;
  const font = (size, weight = 600) => `${weight} ${size}px Georgia, 'Times New Roman', serif`;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#182430');
  bg.addColorStop(1, '#22303d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#cf9f5e';
  ctx.font = font(64, 700);
  ctx.fillText('HIRED!', cx, 330);

  // The brand block is anchored to the bottom of the safe area; the headline shrinks until it fits above it.
  ctx.font = font(34, 400);
  const tagLines = MOMENT_wrapText(ctx, MOMENT_TAGLINE, maxW);
  const tagTop = 1340 - (tagLines.length - 1) * 44;
  const brandY = tagTop - 66;
  const limit = brandY - 100;
  let size = 104;
  let lines;
  for (;;) {
    ctx.font = font(size, 700);
    lines = MOMENT_wrapText(ctx, headline, maxW);
    const subH = sub ? 90 : 0;
    const opH = operator ? 120 : 0;
    if (480 + (lines.length - 1) * (size + 18) + subH + opH <= limit || size <= 56) break;
    size -= 8;
  }
  ctx.fillStyle = '#ffffff';
  let y = 480;
  for (const l of lines) { ctx.fillText(l, cx, y, maxW); y += size + 18; }
  if (sub) {
    ctx.fillStyle = '#cf9f5e';
    ctx.font = font(sub.length > 30 ? 40 : 56, 600);
    y += 10;
    for (const l of MOMENT_wrapText(ctx, sub, maxW)) { ctx.fillText(l, cx, y, maxW); y += 56; }
  }
  if (operator) {
    ctx.fillStyle = '#e9e7e0';
    ctx.font = font(40, 600);
    y += 30;
    for (const l of MOMENT_wrapText(ctx, MOMENT_OPERATOR_LINE, maxW)) { ctx.fillText(l, cx, y, maxW); y += 52; }
  }
  ctx.fillStyle = '#cf9f5e';
  ctx.font = font(72, 700);
  ctx.fillText('AMICO HAUS', cx, brandY, maxW);
  ctx.fillStyle = '#e9e7e0';
  ctx.font = font(34, 400);
  tagLines.forEach((l, i) => ctx.fillText(l, cx, tagTop + i * 44, maxW));
  ctx.font = font(30, 400);
  ctx.fillText(MOMENT_PRESENTED, cx, 1400, maxW);
  ctx.fillText(MOMENT_BROKER, cx, 1444, maxW);
}

async function MOMENT_shareLink() {
  try {
    const { referralCode } = await apiGet('/api/referrals');
    if (referralCode) return `${location.origin}/signup?as=homeowner&ref=${encodeURIComponent(referralCode)}`;
  } catch { /* the plain signup link below */ }
  return MOMENT_FALLBACK_LINK;
}

// Draws the slides the owner left ticked. The operator line can't be turned off: it goes on the pick slide, or on
// the last slide made when the pick slide is off.
function MOMENT_slides(p, bids, picks) {
  const where = [p.city, p.state].filter(Boolean).join(', ');
  const count = MOMENT_count(p, bids);
  const slides = [];
  if (picks.count && count >= 1) slides.push({ headline: `${MOMENT_plural(count, 'agent', 'agents')} sent me proposals`, sub: where });
  if (picks.pick) slides.push({ headline: MOMENT_pickLine(p), pick: true });
  if (picks.turn) slides.push({ headline: 'Your turn', sub: 'Post your home before you list: amicohaus.com' });
  if (p.moment && p.moment.hiredIsOperator && slides.length) (slides.find(s => s.pick) || slides[slides.length - 1]).operator = true;
  return slides;
}

async function MOMENT_makeStory(p, bids) {
  const box = id => { const el = document.getElementById(id); return !!(el && el.checked); };
  const slides = MOMENT_slides(p, bids, { count: box('momentSlideCount'), pick: box('momentSlidePick'), turn: box('momentSlideTurn') });
  if (!slides.length) { toast('Pick at least one slide.'); return; }
  const files = [];
  for (let i = 0; i < slides.length; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    MOMENT_drawSlide(canvas.getContext('2d'), slides[i]);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error("Your browser couldn't make the images.");
    files.push(new File([blob], `amico-haus-hired-${i + 1}.png`, { type: 'image/png' }));
  }
  const link = await MOMENT_shareLink();
  const operator = p.moment && p.moment.hiredIsOperator ? ` ${MOMENT_OPERATOR_LINE}.` : '';
  const text = `I picked my agent on Amico Haus. Your turn: ${link}${operator}`;
  // On a phone or tablet the share sheet is the natural way to post; on a computer each slide downloads.
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, text }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  toast(files.length === 1 ? 'Your Hired! story slide is in your downloads.' : `Your ${files.length} Hired! story slides are in your downloads.`);
}

// ---- Event handling (delegated, so it works for whichever pre-listing is open) ----
(function wireShareMoment() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('[data-moment-action]');
    if (!btn || btn.closest('.moment-overlay')) return;
    const action = btn.dataset.momentAction;
    const p = (typeof decisionView !== 'undefined' && decisionView.p) || momentView.p;
    const bids = (typeof decisionView !== 'undefined' && decisionView.p ? decisionView.bids : momentView.bids) || [];
    if (!p) return;
    if (action === 'reveal') {
      const cards = openedTogether(bids).slice()
        .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')))
        .map((b, i) => ({ letter: MOMENT_letter(i), reel: !!b.hasPitchVideo }));
      openRevealMode(cards, { city: p.city, state: p.state });
    } else if (action === 'story') {
      btn.disabled = true;
      try { await MOMENT_makeStory(p, bids); } catch (err) { toast(err.message || "Your browser couldn't make the images."); } finally { btn.disabled = false; }
    }
  });

  document.addEventListener('change', async (e) => {
    const box = e.target;
    if (!box || !box.dataset || !box.dataset.momentRepost) return;
    const p = (typeof decisionView !== 'undefined' && decisionView.p) || momentView.p;
    if (!p) return;
    const moment = box.dataset.momentRepost;
    const ok = !!box.checked;
    box.disabled = true;
    try {
      const res = await apiPut(`/api/pre-listings/${p.id}/repost-ok`, { moment, ok });
      if (res && res.repost) p.moment = { ...(p.moment || {}), repost: res.repost };
      toast(ok ? 'Thanks! Rudy will see your OK.' : 'Done. Your OK is taken back.');
    } catch (err) {
      box.checked = !ok;
      if (typeof toastActionError === 'function') toastActionError(err); else toast(err.message);
    } finally { box.disabled = false; }
  });
})();
