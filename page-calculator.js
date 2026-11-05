/* Amico Haus — rent calculator ("What could your home fund instead?").
   Rough math from the owner's own numbers, no compounding or inflation: what's left from the sale (value, less the
   owner's own selling-cost guess and loan payoff) divided by a year of rent. The site adds nothing on top (no
   "extra time for paying as a lump sum") and suggests no numbers as facts: every default is a slider the owner
   moves to their own guess. */

function formatYears(years) {
  if (years <= 0) return '0 months';
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} months`;
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  if (months === 0) return `${whole} year${whole === 1 ? '' : 's'}`;
  return `${whole} year${whole === 1 ? '' : 's'}, ${months} month${months === 1 ? '' : 's'}`;
}

// What's left from the sale, and how many years of rent it covers (0 when nothing is left or there's no rent).
function rentMath({ homeValue, sellingCostsPct, loanPayoff, monthlyRent }) {
  const value = Math.max(0, Number(homeValue) || 0);
  const pct = Math.min(Math.max(Number(sellingCostsPct) || 0, 0), 100);
  const left = value * (1 - pct / 100) - Math.max(0, Number(loanPayoff) || 0);
  const annualRent = Math.max(0, Number(monthlyRent) || 0) * 12;
  return { left, years: annualRent > 0 && left > 0 ? left / annualRent : 0 };
}

function recalc() {
  const homeValue = Number(document.getElementById('homeValue').value);
  const sellingCostsPct = Number(document.getElementById('sellingCosts').value);
  const loanPayoff = Number(document.getElementById('loanPayoff').value);
  const monthlyRent = Number(document.getElementById('monthlyRent').value);

  document.getElementById('homeValueReadout').textContent = money(homeValue);
  document.getElementById('sellingCostsReadout').textContent = `${sellingCostsPct}%`;
  document.getElementById('loanPayoffReadout').textContent = money(loanPayoff);
  document.getElementById('monthlyRentReadout').textContent = `${money(monthlyRent)}/mo`;

  const { left, years } = rentMath({ homeValue, sellingCostsPct, loanPayoff, monthlyRent });
  document.getElementById('yearsResult').textContent = years > 0 ? formatYears(years) : '—';
  document.getElementById('rentLabel').textContent = left > 0
    ? `of rent at ${money(monthlyRent)}/mo, before any rent increases`
    : 'Nothing would be left after your selling costs and loan payoff.';
  document.getElementById('netProceedsOut').textContent = left < 0 ? `-${money(Math.round(-left))}` : money(Math.round(left));
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">Hi, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`;
  }

  ['homeValue', 'sellingCosts', 'loanPayoff', 'monthlyRent'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalc);
  });

  document.querySelectorAll('[data-rent]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('monthlyRent').value = btn.dataset.rent;
      recalc();
    });
  });

  recalc();
});
