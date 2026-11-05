// The Terms of Use / Privacy Policy version this release asks people to agree to (terms.html "version", privacy.html
// "Last updated"). Bump both pages and this file together.
export const CURRENT_TERMS_VERSION = '2026-11-05';
export const TERMS_UPDATED_LABEL = 'November 5, 2026';
export function termsCurrent(user) { return !!user && user.terms_version === CURRENT_TERMS_VERSION; }
