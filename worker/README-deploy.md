# Shared community content — deploy guide

The communal daily tiles (**word, knowledge, spanish, music, news, brainflex,
philosophy prompt, and the GMAT daily lesson**) are generated **once per day
server-side** and reused by every dashboard. No visitor needs their own API key for
them, and the whole community costs ~8 Haiku calls/day instead of N-per-user. The GMAT
generator writes 6 fresh questions (2 Quant / 2 Verbal / 2 Data Insights) that feed the
existing adaptive session, recap, FSRS recall and analytics; the curated question bank
stays in the app as an offline fallback, and a "Report a wrong question" control lets you
hide any item whose AI-written answer key looks off.

This is merged into your **existing `fefe-sync` Worker** — the file to deploy is
[`fefe-sync.js`](fefe-sync.js). It keeps `/data` (sync) and `/rss` (news proxy)
**unchanged** and adds `/shared` + a daily cron. It reuses the `SYNC` KV binding and the
`ANTHROPIC_API_KEY` secret already on that Worker; the new cache lives under `shared:*`
keys so it never touches your `dashboard:<code>` sync blobs.

The dashboard already points `SHARED_URL` at `https://fefe-sync.fefedashboard.workers.dev`.

Not shared (stay per-user): weather (free + location-specific), academic (your own
notes), philosophy **chat** (each conversation is unique → still uses a personal key).

---

## Deploy (Cloudflare dashboard, ~3 min)

1. **Paste the code**
   - Workers & Pages → **`fefe-sync`** → **Edit code**.
   - Select all, delete, paste the entire contents of `worker/fefe-sync.js`, **Save & Deploy**.

2. **Confirm the pieces are in place** (they already are, from your setup):
   - **Settings → Bindings**: KV namespace **`SYNC`** bound. ✅
   - **Settings → Variables**: encrypted **`ANTHROPIC_API_KEY`**. ✅
   - *(optional)* add encrypted **`ADMIN_TOKEN`** to protect `/shared/regenerate`.

3. **Add the daily cron** (this is the only new setting)
   - **Settings → Triggers → Cron Triggers → Add** → `0 4 * * *`
     (04:00 UTC ≈ 05:00–06:00 Paris). Pre-generates the day each morning.

4. **Warm & verify**
   - Visit `https://fefe-sync.fefedashboard.workers.dev/shared` — the first hit
     generates today's content (a few seconds), then returns
     `{"date":"…","content":{"word":{…},"worth":{…},…}}`.
   - Reload the dashboard: the communal tiles fill in with **no API key set**.

---

## Notes

- **Cost:** cron generates all 7 keys once/day on Haiku (cents/month), regardless of
  how many people use the dashboard.
- **The key never reaches the browser** — it stays a Worker secret. Visitors read
  finished content only.
- **Abuse guard:** `/shared` only *reads* cache; the lazy first-hit generation is locked
  to one run/day. Only the cron and the token-protected `/shared/regenerate` spend API calls.
- **Timezone:** the shared "day" flips at midnight `Europe/Paris` (the `TZ` const).
- **Sync is untouched:** `/data` and `/rss` are byte-for-byte the same; existing
  sync codes and synced data keep working.
- **Rollback:** if anything looks off, redeploy the previous version from the Worker's
  **Deployments/Versions** tab — the shared logic is additive and self-contained.

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
