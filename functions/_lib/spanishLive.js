// The Spanish pages (es/*.html) and every link to them stay unpublished until Rudy has reviewed each Spanish line and
// Coldwell Banker West (or an attorney) has OK'd Spanish advertising. Flip this to true, set the same flag in
// client.js, rebuild (node build-dist.js) and deploy. While false: build-dist.js leaves es/ out of dist and strips the
// Español links and hreflang tags from the English pages; the server-rendered pages, the sitemap and the app's
// Display language setting leave Spanish out too.
export const SPANISH_LIVE = false;
