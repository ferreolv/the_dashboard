# Shared community content — deploy guide

The communal daily tiles (**word, knowledge, spanish, music, news, brainflex,
philosophy prompt**) are generated **once per day server-side** and reused by every
dashboard. No visitor needs their own API key for them, and the whole community costs
~7 Haiku calls/day instead of N-per-user.

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
