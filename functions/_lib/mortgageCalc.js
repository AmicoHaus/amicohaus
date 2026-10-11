// A quick "estimate your monthly payment" widget for a detail page -- the math itself runs client-side
// (see client.js's initMortgageCalculators()), this just emits the markup with the listing's real price
// baked in as the starting point. Same lender disclaimer language used elsewhere on the site.
export function mortgageCalcHtml(price) {
  return `
    <div class="card about-card">
      <h2>Estimate Your Payment</h2>
      <div class="mortgage-calc" data-price="${Number(price) || 0}">
        <div class="form-row two-col">
          <div class="field"><label>Down payment (%)</label><input type="number" class="mc-down-pct" min="0" max="100" step="1" value="20"></div>
          <div class="field"><label>Interest rate (%)</label><input type="number" class="mc-rate" min="0" max="20" step="0.125" value="6.75"></div>
        </div>
        <div class="field">
          <label>Loan term</label>
          <select class="mc-term">
            <option value="30">30-year fixed</option>
            <option value="15">15-year fixed</option>
          </select>
        </div>
        <div class="mortgage-calc-result">
          <span>Estimated payment</span>
          <strong class="mc-monthly">—</strong>
          <span>/mo (principal &amp; interest)</span>
        </div>
      </div>
      <p class="form-note trust">Illustrative only — not a loan offer, pre-qualification, or guarantee of terms. Excludes property taxes, insurance, and HOA dues. Talk to your own mortgage broker, or use our preferred lender, <strong>Point Mortgage Corporation</strong> (NMLS #231073), at <a href="tel:+16194754095">(619) 475-4095</a>. You can verify any lender's license at nmlsconsumeraccess.org.</p>
    </div>`;
}
