/* Amico Haus — About page: just needs the auth-aware header, same pattern
   as the other public pages (demo, calculator, profile). */
(async function () {
  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">Hi, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`;
  }
})();
