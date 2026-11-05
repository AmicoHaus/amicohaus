/* Amico Haus — the Report button on the server-rendered AugmentedHomes, GreenHomes and FinderMine pages
   (functions/augmented-home/[id].js, functions/green-home/[id].js, functions/project/[id].js). A report is filed
   on the person who posted the home or project, with the page named at the start of the details
   (data-prefill, e.g. "GreenHomes home #12: "). Same short form as the app (client.js inlineReportFormHtml,
   presets incl. "Fair housing concern"). Needs client.js loaded first (apiPost/toast/reportPayload). */
(function () {
  document.addEventListener('click', async e => {
    const reportBtn = e.target.closest('[data-action="report-owner"]');
    if (reportBtn) {
      const host = reportBtn.closest('[data-report-host]');
      if (!host) return;
      const open = host.querySelector(':scope > .inline-report');
      if (open) { open.remove(); return; }
      host.insertAdjacentHTML('beforeend', inlineReportFormHtml('user', reportBtn.dataset.id));
      const details = host.querySelector(':scope > .inline-report .report-details');
      if (details) details.value = reportBtn.dataset.prefill || '';
      return;
    }
    const sendBtn = e.target.closest('[data-action="send-report"]');
    if (sendBtn) {
      const box = sendBtn.closest('.inline-report');
      const preset = box.querySelector('.report-reason').value;
      const details = box.querySelector('.report-details').value.trim();
      if (!preset && !details) { toast('Say what the problem is, then send.'); box.querySelector('.report-details').focus(); return; }
      sendBtn.disabled = true;
      try {
        await apiPost('/api/reports', reportPayload(box.dataset.targetType, box.dataset.targetId, preset, details));
        box.innerHTML = '<p class="tiny">Report sent. Thank you.</p>';
      } catch (err) { sendBtn.disabled = false; toastActionError(err); }
      return;
    }
    const cancelBtn = e.target.closest('[data-action="cancel-report"]');
    if (cancelBtn) cancelBtn.closest('.inline-report').remove();
  });
})();
