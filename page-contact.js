(async function () {
  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">Hi, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`;
  }
})();

document.getElementById('contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const note = document.getElementById('resultNote');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await apiPost('/api/contact', {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      message: document.getElementById('message').value.trim(),
    });
    note.textContent = "Thanks — Rudy will get back to you soon.";
    document.getElementById('contactForm').style.display = 'none';
  } catch (err) {
    toast(err.message);
    btn.disabled = false; btn.textContent = 'Send';
  }
});
