# Testing Amico Haus

Two kinds of tests:

- **Offline suites** (`tools/*-test.mjs`, `tools/agent-render-test.js`, `tools/applink-test.js`) run the real handlers on an
  in-memory SQLite copy of `schema.sql`. No network, no Cloudflare. Run them with the absolute project root:
  `node --disable-warning=ExperimentalWarning tools/<name>-test.mjs "C:/Users/rudyp/Desktop/Claude App/PendingWork v8.26P"`
- **The authorization suite** (`tools/authz-test.js`) signs up real accounts, posts listings and approves two fake agents
  over HTTP. It must never run on amicohaus.com: fake agents and listings would be public there until cleanup. It runs
  against a **preview deployment** that uses its own **test database and photo bucket**.

**Status (2026-11-05):** the one-time setup below is DONE (test D1 `amicohaus-test`, bucket `amicohaus-test-photos`,
`[env.preview]` in wrangler.toml, preview alias https://authz-preview.amicohaus.pages.dev). First full run: 473/473.
Step 4 (copying secrets to Preview) was skipped: without the email key, signup answers 202 `emailDelayed` and the
suite plants its own link token, so it doesn't need email.

## One-time setup (Rudy runs these; the build never creates Cloudflare resources)

1. Create the test database and bucket:
   ```
   npx wrangler d1 create amicohaus-test
   npx wrangler r2 bucket create amicohaus-test-photos
   ```
2. Load the schema and the ZIP data into the test database:
   ```
   npx wrangler d1 execute amicohaus-test --remote --file schema.sql
   npx wrangler d1 execute amicohaus-test --remote --file zip_codes_data.sql
   ```
3. Bind them to **Preview deployments only** by adding this to `wrangler.toml` (production keeps the top-level
   `amicohaus` / `amicohaus-photos` bindings; use the `database_id` that step 1 printed):
   ```toml
   [env.preview]

   [[env.preview.d1_databases]]
   binding = "DB"
   database_name = "amicohaus-test"
   database_id = "<id from wrangler d1 create>"

   [[env.preview.r2_buckets]]
   binding = "PHOTOS"
   bucket_name = "amicohaus-test-photos"
   ```
   Production deploys read this file too: leave the top-level `[[d1_databases]]` and `[[r2_buckets]]` blocks exactly as
   they are. The preview block must list every binding (today just DB and PHOTOS), because an environment block does
   not inherit them.
4. In the Pages dashboard, copy the secrets and variables (email key etc.) to the **Preview** environment.

## Each run

1. Deploy a preview (never the production branch):
   ```
   node build-dist.js && npx wrangler pages deploy dist --project-name=amicohaus --branch=authz-preview --commit-dirty=true
   ```
2. Run the suite against that branch's own URL (not a `<hash>.amicohaus.pages.dev` link of a production deployment):
   ```
   AUTHZ_BASE=https://authz-preview.amicohaus.pages.dev AUTHZ_D1=amicohaus-test AUTHZ_R2=amicohaus-test-photos node tools/authz-test.js "<projectRoot>"
   ```
   PowerShell:
   ```
   $env:AUTHZ_BASE = 'https://authz-preview.amicohaus.pages.dev'; $env:AUTHZ_D1 = 'amicohaus-test'; $env:AUTHZ_R2 = 'amicohaus-test-photos'; node tools/authz-test.js "<projectRoot>"
   ```
3. Cleanup runs automatically at the end (and after a crash). If it reports `CLEANUP FAILED`, run
   `node tools/authz-cleanup.js "<projectRoot>"` by hand with the same `AUTHZ_*` variables.

## Rules the scripts enforce (`tools/authz-target.js`)

- `AUTHZ_BASE` (an `https://` URL), `AUTHZ_D1` and `AUTHZ_R2` are all required (the test needs the bucket for its automatic cleanup). There is no default.
- amicohaus.com and any of its subdomains, amicohaus.pages.dev, the `amicohaus` database and the `amicohaus-photos`
  bucket are refused. `AUTHZ_ALLOW_PROD=1` overrides that for an emergency only: the fake agents and listings are live on the real
  site until cleanup finishes.
- Interim production guards, in case a test account ever lands there: `@resend.dev` accounts' pages are `noindex` and
  they stay out of the sitemap and the home page's public counts.

## Other tools

- `tools/amico-growth-report.js` reads production with small `--command` batches only (never `--file`, which goes
  through the D1 import API: no rows come back and the database can't serve queries while it runs). Its offline tests
  are in `tools/launch-test.mjs` and `tools/compliance2-test.mjs`.
