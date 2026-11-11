/* Amico Haus — the /for-agents one-pager: the auth-aware header (same as page-about.js), the "Print this page"
   button, and signed-in visitors' apply buttons go straight to the agent application in the app. */
document.querySelectorAll('[data-print-page]').forEach(btn => btn.addEventListener('click', () => window.print()));

// es/agentes (lang="es") loads this file too and gets the Spanish header.
(async function () {
  const es = document.documentElement.lang === 'es';
  const user = await fetchCurrentUser();
  if (!user) return;
  document.getElementById('authCta').innerHTML =
    `<span class="tiny">${es ? 'Hola' : 'Hi'}, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">${es ? 'Ir a la aplicación (en inglés)' : 'Go to App'}</a>`;
  document.querySelectorAll('[data-join-agent]').forEach(a => { a.href = '/app#become-agent'; });
})();
