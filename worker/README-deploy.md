# Daily content — safe retry and deployment

The shared Word, Knowledge, Spanish, Music, World, Brainflex, Philosophy prompt,
and GMAT daily lesson reuse one successful result per date and tile. Retrying fills
only missing or failed content. It never replaces a valid result, including when
several browsers request it together or the cron overlaps a manual retry.

This is merged into your **existing `fefe-sync` Worker** — the file to deploy is
[`fefe-sync.js`](fefe-sync.js). It keeps `/data` (sync) and `/rss` (news proxy)
and adds daily-content routes plus a cron. It reuses `SYNC` KV and the
`ANTHROPIC_API_KEY` secret, and now requires a SQLite-backed `DAILY_COORDINATOR`
Durable Object binding for generation. Existing `shared:*` and account snapshots
are imported on first use; the KV namespace must be preserved.

The dashboard already points `SHARED_URL` at `https://fefe-sync.fefedashboard.workers.dev`.

Academic is private to the signed-in account. Its daily endpoint uses a supplied
personal API key only for that request, stores the successful study capsule, and
returns that capsule on later requests even if the key or course changes. Raw
course notes and the key are never persisted by this endpoint. Weather stays
location-specific; Philosophy conversations still use the personal key separately.

---

## Deploy the Worker and binding together

1. This repository’s `wrangler.toml` is already configured for the existing live
   `fefe-sync` Worker and `SYNC` namespace. Use it for this deployment. For another
   environment, copy `wrangler.toml.example` to `wrangler.toml` and replace
   the namespace placeholder with the **existing** `SYNC` KV namespace ID. Keep
   any existing account ID, routes, environment variables, and other bindings.
   The example adds the `DailyCoordinator` export, a `DAILY_COORDINATOR` binding,
   and a SQLite namespace migration. Do not replace `SYNC` with a fresh namespace.

2. From `worker/`, use an authenticated Wrangler session to deploy:

   ```sh
   npx wrangler deploy
   ```

   Keep the existing encrypted `ANTHROPIC_API_KEY`. No personal key belongs in
   Wrangler configuration. `ADMIN_TOKEN` still protects the old
   `/shared/regenerate` alias when configured; that alias now only retries gaps.
   A code-only paste without the binding serves existing cached content but
   returns `server_unconfigured` for missing tiles and does not call the provider.
   This avoids claiming that KV's eventually consistent lock is safe.

2b. **Which tiles get generated** — by default this build is **token-frugal**:
   with nothing configured it generates only **`word` + `gmat` + `german`**, so a
   fresh deploy never spends API calls on tiles nobody asked for. To change the
   set, two ways, in precedence order:
   - **In-app (recommended):** the dashboard's **Settings → "Daily AI content"**
     checklist. Ticking/unticking a tile writes a `shared_config` KV key the cron
     reads, so you control it per-tile with no Cloudflare edits. The card's
     **"Check server"** button confirms the worker is honoring your selection.
   - **Manual fallback:** a plain-text **`SHARED_TILES`** variable
     (**Settings → Variables**) with a comma-separated list, e.g. `word,gmat,german`,
     or all nine to generate everything.
   An empty checklist means no shared generation. Enabling a missing tile allows
   the next request or retry to fill it; disabling one never erases content that
   already loaded that day.

3. The example retains the daily cron, `0 4 * * *`. Cron and browser requests
   use the same coordinator and cannot replace each other's completed tiles.

4. **Warm & verify**
   - Visit `https://fefe-sync.fefedashboard.workers.dev/shared` — the first hit
     generates today's content (a few seconds), then returns
     `{"date":"…","content":{"word":{…},"worth":{…},…}}`.
   - Repeat that request and `POST /shared/retry` for the same date. Ready content
     must stay identical, while incomplete content remains absent with a status.
   - Run `node --test worker/fefe-sync.test.mjs` before publishing changes.

---

## Publish the dashboard HTML and public assets

The live Worker serves `index.html` from the existing `SYNC` key `__html__`.
A GitHub push or Worker-code deployment alone does not update that copy. Publish
both the Worker and its public files when a dashboard change affects either.

From the repository root, after validating the final dashboard:

```sh
node --test src/dashboard/daily-content.test.cjs src/dashboard/daily-ux.test.cjs src/dashboard/password-recovery.test.cjs worker/fefe-sync.test.mjs worker/password-recovery.test.mjs
node worker/prepare-dashboard-assets.mjs
npx wrangler deploy --config worker/wrangler.toml
npx wrangler kv bulk put backups/dashboard-public-kv.json --binding SYNC --remote --config worker/wrangler.toml
```

The preparation command has no network access. It reads only the explicit allowlist:
`index.html`, `dashboard.webmanifest`, and the five icons in `assets/icons/`.
It writes seven KV entries into ignored `backups/dashboard-public-kv.json` and
prints their byte counts and SHA-256 hashes. Regenerate this bundle after any
further HTML or asset edit; do not upload a bundle prepared from an older version.

HTML uses `__html__`; the other six entries use `asset:/<public path>`.
The JSON uses Wrangler's supported `{key,value,base64:true}` bulk format so icon
bytes and the exact HTML bytes survive publication. The helper never reads
account snapshots, local browser data, personal backups, or credentials, and
publishing these seven keys does not alter saved daily content or streaks.

The Worker supplies the manifest/icon content types. Verify that the live root
contains the new UI, `/dashboard.webmanifest` returns a manifest, and all five
icon URLs return PNGs. A missing or unrecognised asset must return 404 rather
than the dashboard HTML. KV publication can take time to reach every location;
verify the live HTML and assets again after propagation. Keep the existing KV
namespace and encrypted secrets throughout deployment.

## Password recovery email

Sign-in offers **Forgot password?** and sends a 20-minute single-use link. The
reset page works before account sync and while already signed in. Resetting keeps
all saved dashboard data, invalidates prior sessions and reset links, and requires
a normal sign-in with the new password. Legacy credentials import into the existing
SQLite coordinator on first use; retain the DAILY_COORDINATOR binding.
Authentication fails closed without that binding, so a configuration outage cannot
reactivate sessions revoked by a password reset. Do not roll back to the KV-only
authentication code after credentials migrate.

Configure one real sender before offering email recovery in production:

- **Cloudflare Email Service:** onboard a sending domain, set AUTH_EMAIL_FROM
  to an allowed sender, and add a send_email binding named AUTH_EMAIL. Cloudflare
  currently requires Workers Paid for Email Sending; review the account’s plan.
- **Resend:** verify the sending domain, set AUTH_EMAIL_FROM to its sender address,
  and store RESEND_API_KEY as an encrypted Worker secret. Never put this key in Git.
  Without a domain, onboarding@resend.dev can test recovery only to the email on
  the Resend account. The current config prepares that limited sender; the UI
  explicitly describes its recipient restriction. Verify a domain before enabling
  delivery for other dashboard users.
- Set AUTH_APP_URL to the trusted HTTPS dashboard address. The default is the
  existing workers.dev site. Request Host/Origin and client redirect fields never
  determine reset links. The token stays in the URL fragment and is removed by the
  page before third-party scripts load.

If no sender is configured, the endpoint returns a clear recovery_unavailable
error. It never pretends an email was sent. Configured requests return an identical
neutral acknowledgement for known and unknown addresses; delivery runs in the
background. Provider failures invalidate that link and log a fixed, non-personal
error message. Monitor delivery at the provider and use a new request if no email
arrives. Tokens and passwords are never logged or stored in browser storage.

POST /auth/forgot-password accepts {email}; POST /auth/reset-password accepts
{token,password}. Requests are rate limited. Only token hashes are persisted;
reset consumption and the new password are committed together. Reset passwords
use salted PBKDF2; existing password hashes remain readable during migration.

Validate with node --test worker/password-recovery.test.mjs. The security model
follows [OWASP’s forgot-password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
Email integration references: [Cloudflare Workers email binding](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
and [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email).

## HTTP contract

- `GET /shared?date=YYYY-MM-DD` returns `{date,content,status,frozen:true}` and
  loads missing enabled tiles. `POST /shared/retry?date=YYYY-MM-DD` accepts
  `{keys:["word",...]}`. Neither route overwrites ready content.
- `status[key].state` distinguishes readiness, missing content, disabled content,
  missing or rejected keys, missing course notes, provider/rate-limit/feed errors,
  incomplete responses, and server configuration or storage failures. Each failure
  includes explanatory text where action is needed. Invalid/incomplete model responses are never
  returned as successful tiles or added to history.
- `POST /daily/personal` requires `Authorization: Bearer <account session>` and
  `{date,key:"academic",apiKey,course:{id,name,content},avoid:[]}`. It returns the
  same date/content/status envelope. Existing success is checked before prerequisites;
  missing prerequisites use `missing_key` or `missing_course`.
- `/shared/config` exposes `active`, `all`, and `safeRetry` in addition to the
  existing `tiles` setting. Default generation stays `word` + `gmat` + `german`.
- With the binding configured, account snapshot reads/writes use the same
  account coordinator. A later sync cannot erase or replace valid
  `fefe_daily:YYYY-MM-DD` fields, and older timestamps still cannot replace newer
  snapshots. API keys and session tokens are stripped server-side too.
- Explicit dates follow the profile's logical day; only dates within 36 hours of
  the present may initiate generation. Historical records are read-only. Requests
  without a date and the cron default to the current Paris calendar date.

## Interrupted loads

A durable reservation is written before every provider call. Simultaneous
requests queue behind it. Independent tiles load in parallel with bounded provider,
feed and catalog requests. Durable commits remain ordered, so one slow tile does
not delay a finished neighbour’s save. Completed content is committed tile by tile, so one
failure does not discard its neighbours. A known API failure can be retried.

If the object restarts during a provider call, a retry checks durable content
first. A committed result is reused; an uncommitted attempt can run again. The
guarantee is one successful visible result per day, not one network attempt:
provider calls cannot participate in Cloudflare's storage transaction. Retrying
an interrupted attempt never requires deleting a finished tile or resetting its
completion state.

The old KV `shared_lock:*` records are no longer used. KV mirrors remain for
compatibility and recovery, while the Durable Object is authoritative after its
first import. Do not roll back to the old force-regeneration code: it would ignore
that authority. The design follows Cloudflare's guidance on
[Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and [SQLite namespace migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

---

# Health ingest (Garmin) — deploy guide

A second, separate Worker (`health-ingest.js`) is a tiny **token-keyed store** for your
own daily health summaries. A scheduled script (`scripts/garmin_to_dashboard.py`) pushes
Garmin data to it; the dashboard pulls that data in on load and merges it into the Health
tile. It is deliberately **separate from the cross-device sync store** so a script write
can never clobber the whole-state snapshot.

The dashboard points at `https://fefe-health.fefedashboard.workers.dev`. If you deploy
under a different name, update `HEALTH_URL` in `index.html`.

## Deploy the Worker

**Cloudflare dashboard:**
1. Workers & Pages → **Create Worker**, name it **`fefe-health`**. Deploy, then **Edit
   code**, paste all of `health-ingest.js`, **Save & Deploy**.
2. Workers & Pages → **KV** → **Create namespace** (e.g. `fefe_health`).
3. The `fefe-health` Worker → **Bindings** (or **Settings → Variables → KV Namespace
   Bindings**) → **Add**: variable name **`HEALTH`** (exactly), select the namespace. Save.

**Or Wrangler** — create `wrangler.toml` next to `health-ingest.js`:

```toml
name = "fefe-health"
main = "health-ingest.js"
compatibility_date = "2024-11-01"
kv_namespaces = [{ binding = "HEALTH", id = "PASTE_KV_ID_HERE" }]
```

```bash
wrangler kv namespace create fefe_health   # paste the id above
wrangler deploy
```

No secrets are needed — the token lives in the data key, chosen by you.

## Connect the dashboard

1. Pick a long, random **token** (8+ chars, letters/numbers/`-`/`_`).
2. Dashboard → **Settings → Health bridge → Garmin — automatic**: paste the token,
   press **Connect Garmin**. (It stays on this device and is never synced.)

## Run the Garmin puller

Fill in the **same token** and your Garmin login as secrets, never in the file.

- **Automatic (recommended):** the included GitHub Action
  `.github/workflows/garmin-sync.yml` runs daily. Add repo secrets
  `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `HEALTH_INGEST_URL`, `HEALTH_TOKEN`
  (Settings → Secrets and variables → Actions). Trigger a first run from the Actions tab.
- **Manual / your own cron:**
  ```bash
  pip install -r scripts/requirements.txt
  GARMIN_EMAIL=... GARMIN_PASSWORD=... \
  HEALTH_INGEST_URL=https://fefe-health.fefedashboard.workers.dev \
  HEALTH_TOKEN=... \
  python scripts/garmin_to_dashboard.py
  ```

## Notes & safety

- **Unofficial:** `garminconnect` reverse-engineers Garmin's internal API and isn't
  sanctioned — it can break when Garmin changes things. Bump the version in
  `scripts/requirements.txt` if a run starts failing.
- **Credentials:** your Garmin email/password live only as script env vars / repo
  secrets, never in the repo or the browser.
- **The token is a shared secret:** anyone with it can read/write your health days
  (health only — nothing else in the dashboard). Keep it random; rotate by picking a new
  one in both places.
- **Metrics carried:** steps, sleep, resting HR, active kcal, Body Battery, stress, HRV,
  and workouts. Apple Health never carried the Garmin-only ones (Body Battery/stress/HRV).
- **Cap:** the store keeps the most recent 180 days per token.
