# Shared community content — deploy guide

This Worker (`shared-content.js`) generates the **common daily tiles once per day**
using **one** Anthropic key kept on the server, caches them, and serves the same
content to every dashboard. Result: ~7 Haiku calls/day for the whole community, and
**no visitor ever needs their own API key** for these tiles.

Shared tiles: **word, knowledge (worth), spanish, music, news (world), brainflex,
philosophy prompt.**
Not shared (stay per-user): weather (free + location-specific), academic (your own
notes), philosophy **chat** (each conversation is unique → still uses a personal key).

The dashboard already points at `https://fefe-shared.fefedashboard.workers.dev`.
If you deploy under a different name, update `SHARED_URL` in `index.html`.

---

## Option A — Cloudflare dashboard (no tools, ~10 min)

1. **Create the Worker**
   - Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**.
   - Name it **`fefe-shared`** (so the URL matches the one already in `index.html`).
   - **Deploy**, then **Edit code**, paste the entire contents of `shared-content.js`, **Save & Deploy**.

2. **Add the KV store**
   - Workers & Pages → **KV** → **Create namespace**, name it e.g. `fefe_shared`.
   - Open the `fefe-shared` Worker → **Settings → Variables → KV Namespace Bindings** → **Add binding**.
   - Variable name **`SHARED`** (exactly), select the `fefe_shared` namespace. Save.

3. **Add the API key as a secret**
   - Same Worker → **Settings → Variables → Environment Variables** → **Add** →
     **Encrypt**. Name **`ANTHROPIC_API_KEY`**, value = your Anthropic key. Save.
   - (Optional) add another encrypted variable **`ADMIN_TOKEN`** with any random string,
     to protect the manual `/shared/regenerate` endpoint.

4. **Add the daily cron**
   - Same Worker → **Settings → Triggers → Cron Triggers → Add** → `0 4 * * *`
     (04:00 UTC = ~05:00/06:00 Paris). This pre-generates each morning.

5. **Test**
   - Visit `https://fefe-shared.fefedashboard.workers.dev/shared` — the first hit
     generates today's content (takes a few seconds), then returns JSON like
     `{"date":"2026-07-30","content":{"word":{...},"worth":{...},...}}`.
   - Reload your dashboard — the shared tiles fill in with no API key set.

---

## Option B — Wrangler CLI

```bash
npm i -g wrangler
wrangler login
wrangler kv namespace create fefe_shared          # note the returned id
```

Create `wrangler.toml` next to `shared-content.js`:

```toml
name = "fefe-shared"
main = "shared-content.js"
compatibility_date = "2024-11-01"

kv_namespaces = [{ binding = "SHARED", id = "PASTE_KV_ID_HERE" }]

[triggers]
crons = ["0 4 * * *"]
```

```bash
wrangler secret put ANTHROPIC_API_KEY     # paste the key when prompted
# wrangler secret put ADMIN_TOKEN         # optional
wrangler deploy
curl https://fefe-shared.<your-subdomain>.workers.dev/shared   # warm + verify
```

---

## Cost & safety notes

- **Cost:** cron generates all 7 keys once/day on Haiku (~a few cents/month total),
  no matter how many people use the dashboard.
- **The key is never in the browser.** It lives only as a Worker secret. Visitors read
  finished content; they cannot see or spend the key.
- **Abuse guard:** `/shared` only *reads* cache (the lazy path is locked to one
  generation per day). Only the cron and the token-protected `/shared/regenerate`
  can trigger new API calls.
- **Timezone:** the shared "day" flips at midnight `Europe/Paris` (set by `TZ` in the
  Worker). Users elsewhere may see the previous day's set until then — expected for a
  shared feed.
- **Personal tiles unchanged:** academic + philosophy chat still use each user's own
  key from Settings; if someone has no key, those two simply stay in their empty state.
