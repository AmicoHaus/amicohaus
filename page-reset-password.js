const token = new URLSearchParams(window.location.search).get('token');
if (!token) {
  document.getElementById('resultNote').textContent = 'This link is missing its token — request a new reset link.';
  document.getElementById('resetForm').style.display = 'none';
}

document.getElementById('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const note = document.getElementById('resultNote');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await apiPost('/api/auth/reset-password', { token, password: document.getElementById('password').value });
    note.textContent = 'Password updated. You can now log in.';
    document.getElementById('resetForm').style.display = 'none';
  } catch (err) {
    toast(err.message);
    btn.disabled = false; btn.textContent = 'Set Password';
  }
});
