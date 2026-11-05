/* Amico Haus — the /for-agents one-pager: the auth-aware header (same as page-about.js), the "Print this page"
   button, and signed-in visitors' apply buttons go straight to the agent application in the app. */
document.querySelectorAll('[data-print-page]').forEach(btn => btn.addEventListener('click', () => window.print()));

(async function () {
  const user = await fetchCurrentUser();
  if (!user) return;
  document.getElementById('authCta').innerHTML =
    `<span class="tiny">Hi, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`;
  document.querySelectorAll('[data-join-agent]').forEach(a => { a.href = '/app#become-agent'; });
})();
