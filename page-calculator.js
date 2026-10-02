/* Amico Haus — trade-for-lease slide-rule calculator.
   Simple illustrative math, no compounding/inflation: net sale proceeds
   divided by annual rent gives the exact-math low end of the range.
   A lump-sum prepayment of years of rent is worth more to a landlord than
   the same total collected month by month — no vacancy risk, no collections
   risk, cash in hand today — so the high end of the range adds 15% more
   time in exchange for paying it all upfront. Same LUMP_SUM_BONUS_PCT as
   the server's RENTAL_LUMP_SUM_BONUS_PCT (functions/_lib/util.js) — kept in
   sync manually since this runs as a static client-side script with no
   shared module boundary with the Cloudflare Functions backend. */

const LUMP_SUM_BONUS_PCT = 0.15;

function formatYears(years) {
  if (years <= 0) return '0 months';
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} months`;
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  if (months === 0) return `${whole} year${whole === 1 ? '' : 's'}`;
  return `${whole} year${whole === 1 ? '' : 's'}, ${months} month${months === 1 ? '' : 's'}`;
}

function recalc() {
  const homeValue = Number(document.getElementById('homeValue').value);
  const sellingCostsPct = Number(document.getElementById('sellingCosts').value);
  const monthlyRent = Number(document.getElementById('monthlyRent').value);

  document.getElementById('homeValueReadout').textContent = money(homeValue);
  document.getElementById('sellingCostsReadout').textContent = `${sellingCostsPct}%`;
  document.getElementById('monthlyRentReadout').textContent = `${money(monthlyRent)}/mo`;

  const netProceeds = homeValue * (1 - sellingCostsPct / 100);
  const annualRent = monthlyRent * 12;
  const yearsLow = annualRent > 0 ? netProceeds / annualRent : 0;
  const yearsHigh = yearsLow * (1 + LUMP_SUM_BONUS_PCT);

  document.getElementById('yearsResult').textContent = yearsLow > 0
    ? `${formatYears(yearsLow)} – ${formatYears(yearsHigh)}`
    : '—';
  document.getElementById('rentLabel').textContent = `of ${money(monthlyRent)}/mo living, before rent increases — low end is the exact math, high end is for paying it all as a lump sum upfront`;
  document.getElementById('netProceedsOut').textContent = money(Math.round(netProceeds));
  document.getElementById('bonusTimeOut').textContent = yearsLow > 0 ? `+${formatYears(yearsHigh - yearsLow)}` : '—';
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">Hi, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`;
  }

  ['homeValue', 'sellingCosts', 'monthlyRent'].forEach(id => {
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
