/* Amico Haus — About page: just needs the auth-aware header, same pattern
   as the other public pages (demo, calculator, profile). */
// The Spanish twins (es/index, es/acerca, es/accesibilidad; lang="es") load this file too and get the Spanish header.
(async function () {
  const es = document.documentElement.lang === 'es';
  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">${es ? 'Hola' : 'Hi'}, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">${es ? 'Ir a la aplicación (en inglés)' : 'Go to App'}</a>`;
  }
})();
