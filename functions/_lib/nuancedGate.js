// Launch gate for the nuanced-ideas tools (Rudy 11.13: the legal wording gets an attorney's look before launch). A
// tool that is false here is built and tested but only admin accounts see it, so Rudy can walk through it first.
// Turning a tool on is a one-word change here plus a deploy he approves. Never read from the database.
export const NUANCED_TOOLS = {
  runCosts: true, willItFit: true, signalMap: true, termsWishlist: true, sellAndStay: true, watchAreas: true,
  areaContext: false,   // on after tools/load-sdge-usage.mjs has been run and Rudy has looked at the numbers
  fccCoverage: false,   // on after tools/load-fcc-mobile.mjs has been run and Rudy has looked at the output
  headStart: false,     // on after CB West OKs the Clear Cooperation note
  easementIdeas: false, openFor: false, standingOffer: false, stepDown: false, ownerCarry: false, testDrive: false, // attorney list, §14
  // MLS tools (11.16, mlsTools.js): CRMLS aggregates by ZIP. On for everyone: Rudy's broker approved them (11.16). Each
  // endpoint still decides sign-in (MLS-TOOLS-NOTES.md: all three MLS endpoints need a sign-in, Rudy 11.17; no public
  // page). The Area Pulse monthly email has its own switch, AREA_PULSE_EMAIL_LIVE in mlsTools.js (still off).
  areaPulse: true, pricePath: true, marketPace: true, homeFits: true, featureLens: true, daysCurve: true, watchersPulse: true,
};
// env.NUANCED_ALL_LIVE === '1' turns everything on: the test harness and the preview test env only, never production.
export function toolLive(env, name, user = null) {
  if (!Object.hasOwn(NUANCED_TOOLS, name)) return false;
  if (env && env.NUANCED_ALL_LIVE === '1') return true;
  return NUANCED_TOOLS[name] || (!!user && user.role === 'admin');
}
export function liveTools(env, user = null) { return Object.fromEntries(Object.keys(NUANCED_TOOLS).map(k => [k, toolLive(env, k, user)])); }
