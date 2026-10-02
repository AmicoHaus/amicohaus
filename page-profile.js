/* Amico Haus — public user profile page. */

function profileListingCard(l) {
  const loc = `${l.neighborhood ? escapeHtml(l.neighborhood) + ', ' : ''}${escapeHtml(l.city)}, ${escapeHtml(l.state)}`;
  return `
    <div class="card">
      <img class="directory-thumb" src="${l.photo_id ? `/api/photos/${l.photo_id}` : propertyArtUrl(l.property_type, l.id)}" alt="" loading="lazy">
      <div class="card-head">
        <h3><a class="profile-link" href="/listing/${l.id}">${escapeHtml(l.title || l.property_type)}</a></h3>
        <span class="badge badge-gold">${l.is_portfolio ? `Portfolio · ${(l.portfolio_members || []).length}` : (l.is_rental ? 'For Rent' : escapeHtml(l.price_tier))}</span>
      </div>
      <div class="mini-two">
        <div class="mini-block"><span class="label">Has</span>${l.is_portfolio ? `${(l.portfolio_members || []).length} properties` : `${escapeHtml(l.property_type)} · ${l.beds}bd/${l.baths}ba`}<br>${loc}<br>${money(l.estimated_value)}${l.is_portfolio ? ' combined' : ''}</div>
        ${l.is_portfolio
          ? `<div class="mini-block"><span class="label">Includes</span>${(l.portfolio_members || []).map(m => `${escapeHtml(m.propertyType)} in ${escapeHtml(m.city)}, ${escapeHtml(m.state)}`).join('<br>')}</div>`
          : (l.is_rental
            ? `<div class="mini-block"><span class="label">Rent</span>${money(l.rent_amount)}/mo<br>${l.min_lease_months}-month min lease</div>`
            : (l.desired_type ? `<div class="mini-block"><span class="label">Wants</span>${escapeHtml(l.desired_type)} in ${escapeHtml(l.locations || 'Anywhere')}<br>${money(l.price_min)}–${money(l.price_max)}</div>` : ''))}
      </div>
      ${renderExternalLinks(l.external_links)}
    </div>
  `;
}

function profilePostItem(p) {
  return `
    <div class="side">
      <p class="tiny">${escapeHtml(p.body)}</p>
      <span class="tiny">${timeAgo(p.created_at)} · 👍 ${p.like_count} · 💬 ${p.comment_count}</span>
    </div>
  `;
}

async function saveBio(userId, currentBio) {
  const el = document.getElementById('bioSection');
  el.innerHTML = `
    <textarea id="bioInput" maxlength="500" placeholder="Tell other homeowners a bit about yourself and what you're hoping to find…">${escapeHtml(currentBio)}</textarea>
    <div class="form-actions">
      <button type="button" class="btn btn-primary btn-sm" id="saveBioBtn">Save</button>
      <button type="button" class="btn btn-ghost btn-sm" id="cancelBioBtn">Cancel</button>
    </div>
  `;
  document.getElementById('saveBioBtn').addEventListener('click', async () => {
    const bio = document.getElementById('bioInput').value.trim();
    try {
      await apiPut('/api/me', { bio });
      toast('Profile updated.');
      loadProfile(userId);
    } catch (err) { toast(err.message); }
  });
  document.getElementById('cancelBioBtn').addEventListener('click', () => loadProfile(userId));
}

async function savePhone(userId, currentPhone) {
  const el = document.getElementById('phoneSection');
  el.innerHTML = `
    <input type="tel" id="phoneInput" maxlength="30" placeholder="e.g. (619) 555-0123" value="${escapeHtml(currentPhone)}">
    <div class="form-actions">
      <button type="button" class="btn btn-primary btn-sm" id="savePhoneBtn">Save</button>
      <button type="button" class="btn btn-ghost btn-sm" id="cancelPhoneBtn">Cancel</button>
    </div>
  `;
  document.getElementById('savePhoneBtn').addEventListener('click', async () => {
    const phone = document.getElementById('phoneInput').value.trim();
    try {
      await apiPut('/api/me', { phone });
      toast('Contact info updated.');
      loadProfile(userId);
    } catch (err) { toast(err.message); }
  });
  document.getElementById('cancelPhoneBtn').addEventListener('click', () => loadProfile(userId));
}

async function loadProfile(userId) {
  const container = document.getElementById('profileContent');
  try {
    const [{ user, listings, posts }, me] = await Promise.all([
      apiGet(`/api/users/${userId}`),
      fetchCurrentUser(),
    ]);

    const isMine = me && me.id === user.id;
    const isAdmin = me && me.role === 'admin' && !isMine;
    const joined = user.createdAt ? new Date(user.createdAt + 'Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';

    container.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <h1>${escapeHtml(user.displayName)} ${user.isVerified ? '<span class="badge badge-verified" title="Verified by Amico Haus">✓ Verified</span>' : ''}</h1>
            ${joined ? `<p class="tiny">Member since ${joined}</p>` : ''}
          </div>
          ${isMine ? '<button type="button" class="btn btn-ghost btn-sm" id="editBioBtn">Edit Profile</button>' : ''}
          ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" id="toggleVerifiedBtn" data-action="${user.isVerified ? 'unverify' : 'verify'}">${user.isVerified ? 'Remove Verification' : 'Mark as Verified'}</button>` : ''}
        </div>
        <div id="bioSection">
          <p>${user.bio ? escapeHtml(user.bio) : '<span class="tiny">No bio yet.</span>'}</p>
        </div>
        <div class="card-head">
          <span class="label">Contact</span>
          ${isMine ? '<button type="button" class="btn btn-ghost btn-sm" id="editPhoneBtn">Edit</button>' : ''}
        </div>
        <div id="phoneSection">
          <p>${user.phone ? escapeHtml(user.phone) : '<span class="tiny">No phone on file.</span>'}</p>
        </div>
      </div>

      <h2>Listings</h2>
      <div class="grid">${listings.length ? listings.map(profileListingCard).join('') : '<div class="empty-state">No active listings.</div>'}</div>

      <h2>Recent Activity</h2>
      <div class="stack">${posts.length ? posts.map(profilePostItem).join('') : '<div class="empty-state">No posts yet.</div>'}</div>
    `;

    if (isMine) {
      document.getElementById('editBioBtn').addEventListener('click', () => saveBio(user.id, user.bio));
      document.getElementById('editPhoneBtn').addEventListener('click', () => savePhone(user.id, user.phone));
    }
    if (isAdmin) {
      document.getElementById('toggleVerifiedBtn').addEventListener('click', async (e) => {
        try {
          await apiPost(`/api/admin/users/${user.id}`, { action: e.target.dataset.action });
          loadProfile(user.id);
        } catch (err) { toast(err.message); }
      });
    }
  } catch (e) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

(async function () {
  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">Hi, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`;
  }

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    document.getElementById('profileContent').innerHTML = '<div class="empty-state">No profile specified.</div>';
    return;
  }
  loadProfile(id);
})();
