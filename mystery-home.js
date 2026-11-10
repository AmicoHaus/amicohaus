/* Amico Haus — Mystery Home Monday (public /mystery-home/<slug> pages only; loaded after client.js).
   The visitor's guess stays in this browser's local storage: this file makes no network call of any kind. After the
   reveal, "how close" is shown on this screen only. The share card never carries a guess, a percentage or a dollar
   figure (a site-made "I came within N%" card under Rudy's DRE # would read as a pricing-accuracy badge). */
(function () {
  const MYSTERY_PAGE = document.querySelector('.mystery-page[data-mystery-slug]');
  if (!MYSTERY_PAGE) return;
  const MYSTERY_SLUG = MYSTERY_PAGE.dataset.mysterySlug;
  const MYSTERY_PLACE = MYSTERY_PAGE.dataset.mysteryPlace || '';
  const MYSTERY_SOLD = Number(MYSTERY_PAGE.dataset.mysterySold) || 0; // only on a revealed page
  const MYSTERY_MONTH = MYSTERY_PAGE.dataset.mysteryMonth || '';
  const MYSTERY_KEY = `ah_mystery_${MYSTERY_SLUG}`;
  const MYSTERY_TAGLINE = "Amico Haus: the real estate marketplace of tomorrow! Everything that's missing from the real estate market for the homeowner!";

  const mysteryMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const mysteryNote = (msg) => { const el = document.getElementById('mysteryGuessResult'); if (el) el.textContent = msg; };
  const mysteryToast = (msg) => { if (typeof toast === 'function') toast(msg); else mysteryNote(msg); };

  function mysteryStored() {
    try {
      const saved = JSON.parse(localStorage.getItem(MYSTERY_KEY) || 'null');
      return saved && Number(saved.guess) > 0 ? saved : null;
    } catch { return null; }
  }

  // Shown on this page only, never drawn, shared or sent anywhere.
  function mysteryShowResult(saved) {
    if (!saved) return;
    const guess = Number(saved.guess);
    if (!MYSTERY_SOLD) { mysteryNote(`Locked in: ${mysteryMoney(guess)}. Come back on reveal day to see how close you came.`); return; }
    const pct = Math.abs(guess - MYSTERY_SOLD) / MYSTERY_SOLD * 100;
    mysteryNote(pct > 50
      ? `You guessed ${mysteryMoney(guess)}. Nice try! You were off by more than half.`
      : `You guessed ${mysteryMoney(guess)}. You came within ${pct.toFixed(1)}%!`);
  }

  function mysteryLock() {
    const input = document.getElementById('mysteryGuess');
    const guess = Math.round(Number(input && input.value));
    if (!Number.isFinite(guess) || guess <= 0) { mysteryToast('Type your guess first.'); return; }
    const saved = { guess, at: Date.now() };
    try { localStorage.setItem(MYSTERY_KEY, JSON.stringify(saved)); } catch { /* storage blocked: still show it below */ }
    mysteryShowResult(saved);
  }

  function mysteryWrap(ctx, text, maxWidth) {
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

  // 9:16 card, everything inside the area the TikTok/Reels/Stories buttons leave uncovered (x 60-960, y 220-1480).
  async function mysteryShareCard() {
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#182430');
    bg.addColorStop(1, '#22303d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const cx = 510;
    const maxW = 840;
    const font = (size, weight = 600) => `${weight} ${size}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#cf9f5e';
    ctx.font = font(44, 600);
    ctx.fillText('MYSTERY HOME MONDAY', cx, 320);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(92, 700);
    let y = 460;
    for (const l of mysteryWrap(ctx, 'I played Mystery Home Monday. Can you guess it?', maxW)) { ctx.fillText(l, cx, y); y += 104; }
    ctx.fillStyle = '#cf9f5e';
    ctx.font = font(56, 600);
    y += 16;
    ctx.fillText(MYSTERY_MONTH ? `${MYSTERY_PLACE} · sold ${MYSTERY_MONTH}` : MYSTERY_PLACE, cx, y, maxW);
    ctx.fillStyle = '#e9e7e0';
    ctx.font = font(40, 400);
    y += 76;
    ctx.fillText('amicohaus.com/mystery-home', cx, y, maxW);
    ctx.font = font(34, 400);
    y += 56;
    ctx.fillText('Just for fun. Not an appraisal.', cx, y, maxW);
    let brandY = Math.max(y + 110, 1090);
    ctx.fillStyle = '#cf9f5e';
    ctx.font = font(76, 700);
    ctx.fillText('AMICO HAUS', cx, brandY);
    ctx.fillStyle = '#e9e7e0';
    ctx.font = font(30, 400);
    brandY += 54;
    for (const l of mysteryWrap(ctx, MYSTERY_TAGLINE, maxW)) { ctx.fillText(l, cx, brandY); brandY += 40; }
    const footY = Math.min(Math.max(brandY + 30, 1400), 1430);
    ctx.font = font(30, 400);
    ctx.fillText('Presented by Rudy Flores, Realtor® · DRE #02257808', cx, footY, maxW);
    ctx.fillText('Coldwell Banker West', cx, footY + 44, maxW);

    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error("Your browser couldn't make the image.");
    const file = new File([blob], 'amico-haus-mystery-home-monday.png', { type: 'image/png' });
    // A phone or tablet gets the share sheet; a computer saves the file.
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Mystery Home Monday on Amico Haus' }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    mysteryToast('Share card saved to your downloads.');
  }

  const lockBtn = document.getElementById('mysteryLockBtn');
  if (lockBtn) lockBtn.addEventListener('click', mysteryLock);
  const shareBtn = document.getElementById('mysteryShareBtn');
  if (shareBtn) shareBtn.addEventListener('click', () => { mysteryShareCard().catch(err => mysteryToast((err && err.message) || "Couldn't make the share card.")); });
  const saved = mysteryStored();
  if (saved) {
    const input = document.getElementById('mysteryGuess');
    if (input) input.value = String(saved.guess);
    mysteryShowResult(saved);
  }
})();
