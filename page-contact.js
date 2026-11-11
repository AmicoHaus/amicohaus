// es/contacto.html (lang="es") loads this same file: ES_MSG holds its visible messages in both languages, and the
// English page shows exactly what it showed before. Server errors stay English in v1 (shown with ES_DETAIL).
const ES_LANG = document.documentElement.lang === 'es';
const ES_MSG = {
  en: { hi: 'Hi', goToApp: 'Go to App', sending: 'Sending…', send: 'Send', thanks: 'Thanks — Rudy will get back to you soon.' },
  es: { hi: 'Hola', goToApp: 'Ir a la aplicación (en inglés)', sending: 'Enviando…', send: 'Enviar', thanks: 'Gracias. Rudy le responderá pronto.' },
}[ES_LANG ? 'es' : 'en'];
const ES_DETAIL = (message) => (ES_LANG ? `No se pudo completar. Detalle (en inglés): ${message}` : message);

(async function () {
  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">${ES_MSG.hi}, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">${ES_MSG.goToApp}</a>`;
  }
})();

document.getElementById('contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const note = document.getElementById('resultNote');
  const errorEl = document.getElementById('contactError');
  btn.disabled = true; btn.textContent = ES_MSG.sending;
  errorEl.classList.add('hidden');
  try {
    await apiPost('/api/contact', {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      message: document.getElementById('message').value.trim(),
      source: getAttribution(),
    });
    note.textContent = ES_MSG.thanks;
    document.getElementById('contactForm').classList.add('hidden');
  } catch (err) {
    // A 503 marked saved means the message is stored but Rudy's notification email didn't go out: treat it as sent
    // (so nobody sends it twice) and show the call/text fallback the server includes.
    if (err.status === 503 && err.data && err.data.saved) {
      note.textContent = ES_LANG ? `Su mensaje quedó guardado. Detalle (en inglés): ${err.message}` : err.message;
      document.getElementById('contactForm').classList.add('hidden');
      return;
    }
    // stays on screen (a toast can hide behind a phone keyboard)
    errorEl.textContent = ES_DETAIL(err.message);
    errorEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = ES_MSG.send;
  }
});
