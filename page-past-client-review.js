/* Amico Haus — the past-client review page an agent shares (Bring Your Reviews): /past-client-review?t=<token>.
   Reviewers sign in first (a real, confirmed email per review); signing in or up from here comes back here. */
(async function () {
  const token = new URLSearchParams(window.location.search).get('t') || '';
  const intro = document.getElementById('reviewIntro');
  const form = document.getElementById('pastReviewForm');
  const here = `/past-client-review?t=${encodeURIComponent(token)}`;

  // Log In / Sign Up from this page come back to it afterwards.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-return-here]')) rememberReturnTo(here);
  });

  let info;
  try {
    info = await apiGet(`/api/past-client-reviews?t=${encodeURIComponent(token)}`);
  } catch (err) {
    intro.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
    return;
  }
  const a = info.agent;
  const period = info.fromYear === info.toYear ? String(info.fromYear) : `${info.fromYear} to ${info.toYear}`;
  document.getElementById('reviewTitle').textContent = `Review ${a.name}`;
  const who = `<p class="lede">${escapeHtml(a.name)}${a.brokerage ? `, ${escapeHtml(a.brokerage)}` : ''}${a.licenseNumber ? ` (DRE #${escapeHtml(a.licenseNumber)})` : ''}, is asking past clients from ${escapeHtml(period)} to share how it went. Your review shows on their Amico Haus profile under "Past clients, outside Amico Haus."</p>`;

  if (info.isTheAgent) {
    intro.innerHTML = `${who}<div class="inline-note">This is your own review link. Send it to every client you helped in ${escapeHtml(period)}.</div>`;
    return;
  }
  if (info.alreadyReviewed) {
    intro.innerHTML = `${who}<div class="inline-note">Thanks, your review is already posted. <a href="/profile/${a.userId}">See ${escapeHtml(a.name)}'s profile →</a></div>`;
    return;
  }
  if (!info.signedIn) {
    intro.innerHTML = `${who}
      <div class="card about-card">
        <p>To keep reviews from real people, posting one takes a free Amico Haus account. It takes a minute, and you'll come right back here.</p>
        <p class="form-actions"><a class="btn btn-primary" href="/signup?as=homeowner" data-return-here>Create a free account</a> <a class="btn btn-ghost" href="/login" data-return-here>I have an account</a></p>
      </div>`;
    return;
  }

  intro.innerHTML = who;
  const yearSelect = document.getElementById('saleYear');
  for (let y = info.toYear; y >= info.fromYear; y--) yearSelect.append(new Option(String(y), String(y)));
  form.classList.remove('hidden');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('pastReviewBtn');
    const errorEl = document.getElementById('pastReviewError');
    errorEl.classList.add('hidden');
    const rating = form.querySelector('input[name="rating"]:checked');
    if (!rating) { errorEl.textContent = 'Pick a star rating.'; errorEl.classList.remove('hidden'); return; }
    btn.disabled = true;
    try {
      await apiPost('/api/past-client-reviews', {
        token, rating: Number(rating.value),
        clientSide: document.getElementById('clientSide').value,
        saleYear: Number(yearSelect.value),
        saleCity: document.getElementById('saleCity').value.trim(),
        saleAddress: document.getElementById('saleAddress').value.trim(),
        comment: document.getElementById('reviewComment').value.trim(),
      });
      form.classList.add('hidden');
      intro.innerHTML = `${who}<div class="inline-note">Thank you! Your review is posted. <a href="/profile/${a.userId}">See ${escapeHtml(a.name)}'s profile →</a></div>`;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
    }
  });
})();
