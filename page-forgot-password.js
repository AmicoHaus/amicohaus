document.getElementById('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const note = document.getElementById('resultNote');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const result = await apiPost('/api/auth/forgot-password', {
      email: document.getElementById('email').value.trim(),
    });
    note.textContent = result.message;
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Send Reset Link';
  }
});
