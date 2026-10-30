/* Amico Haus — the "Sell first or buy first?" planner. Everything is calculated here in the browser; nothing typed
   on this page is saved or sent. */
(function () {
  const form = document.getElementById('plannerForm');
  const out = document.getElementById('plannerResult');
  if (!form || !out) return;

  const num = idName => {
    const v = document.getElementById(idName).value;
    const n = Number(v);
    return v === '' || !Number.isFinite(n) || n < 0 ? 0 : n;
  };
  const dollars = n => (n < 0 ? `-${money(-Math.round(n))}` : money(Math.round(n)));

  function render() {
    const sale = num('pSalePrice');
    const next = num('pNextPrice');
    if (!sale || !next) {
      out.innerHTML = '<p class="tiny">Add your home\'s expected sale price and the next home\'s price to see your numbers.</p>';
      return;
    }
    const costsGiven = document.getElementById('pSellCosts').value !== '';
    const fromSale = sale - num('pPayoff') - num('pSellCosts');
    const down = next * Math.min(num('pDownPct'), 100) / 100;
    const savings = num('pSavings');
    const sellFirstLeft = fromSale + savings - down;
    const buyFirstGap = Math.max(down - savings, 0);
    const saleLabel = costsGiven ? 'From your sale' : 'From your sale, before selling costs';
    // When the sale wouldn't cover what's owed, there's no equity to talk about; say so plainly instead.
    if (fromSale <= 0) {
      out.innerHTML = `
        <div class="opinion-summary"><div><span class="label">${saleLabel}</span>${dollars(fromSale)}</div><div><span class="label">Down payment</span>${dollars(down)}</div><div><span class="label">Your savings</span>${dollars(savings)}</div></div>
        <p>Your sale may not cover what you owe on your home. Your agent and a lender can walk you through your options before you plan the next purchase.</p>`;
      return;
    }
    out.innerHTML = `
      <div class="opinion-summary">
        <div><span class="label">${saleLabel}</span>${dollars(fromSale)}</div>
        <div><span class="label">Down payment</span>${dollars(down)}</div>
        <div><span class="label">Your savings</span>${dollars(savings)}</div>
      </div>
      ${costsGiven ? '' : '<p class="tiny">Add your selling costs (agent fees, title, escrow, transfer tax) for a closer number.</p>'}
      <p><strong>If you sell first:</strong> ${sellFirstLeft >= 0
        ? `your sale and savings cover the down payment, with about ${dollars(sellFirstLeft)} left over for moving and closing costs.`
        : `you'd still need about ${dollars(-sellFirstLeft)} more for the down payment, so it's worth talking with a lender about your options.`}</p>
      <p><strong>If you buy first:</strong> ${buyFirstGap === 0
        ? "your savings may already cover the down payment without your sale money; a lender can confirm what you'd qualify for."
        : `you'd need about ${dollars(buyFirstGap)} for the down payment before your sale closes. That could come from your home's equity (a lender can tell you about a home equity line or bridge loan), or you could make your offer contingent on your sale.`}</p>
      <p class="tiny">Estimates only: a lender will add closing costs on the purchase and confirm what you qualify for.</p>`;
  }

  form.addEventListener('input', render);
  form.addEventListener('submit', e => e.preventDefault());
  render();
})();
