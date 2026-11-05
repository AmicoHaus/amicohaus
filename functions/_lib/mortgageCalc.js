// A quick "estimate your monthly payment" widget for a detail page -- the math itself runs client-side
// (see client.js's initMortgageCalculators()), this just emits the markup with the listing's price baked in as the
// starting point. The rate starts empty ("your rate") and the result reads "—" until the visitor types one: the site
// never suggests a rate, and the result is the visitor's own estimate, not an APR or a rate quote. Same lender
// disclaimer language used elsewhere on the site, including the free choice of lender.
export function mortgageCalcHtml(price) {
  return `
    <div class="card about-card">
      <h2>Estimate Your Payment</h2>
      <div class="mortgage-calc" data-price="${Number(price) || 0}">
        <div class="form-row two-col">
          <div class="field"><label for="mcDownPct">Down payment (%), your guess</label><input type="number" id="mcDownPct" class="mc-down-pct" min="0" max="100" step="1" value="20"></div>
          <div class="field"><label for="mcRate">Interest rate (%)</label><input type="number" id="mcRate" class="mc-rate" min="0" max="20" step="0.125" placeholder="your rate" inputmode="decimal"></div>
        </div>
        <div class="field">
          <label for="mcTerm">Loan term</label>
          <select id="mcTerm" class="mc-term">
            <option value="30">30-year fixed</option>
            <option value="15">15-year fixed</option>
          </select>
        </div>
        <div class="mortgage-calc-result">
          <span>Your estimate (not an APR or a rate quote)</span>
          <strong class="mc-monthly">—</strong>
          <span>/mo (principal &amp; interest)</span>
        </div>
      </div>
      <p class="form-note trust">Rough math from the numbers you type: not a loan offer, pre-qualification, or guarantee of terms. Excludes property taxes, insurance, and HOA dues. Talk to your own mortgage broker, or use our preferred lender, <strong>Point Mortgage Corporation</strong> (NMLS #231073), at <a href="tel:+16194754095">(619) 475-4095</a>. You are always free to choose any lender you like, and you can verify any lender's license at nmlsconsumeraccess.org.</p>
    </div>`;
}
