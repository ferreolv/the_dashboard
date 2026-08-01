/*
 * Fefe — personal health ingest Worker
 * ------------------------------------------------------------------
 * A tiny token-keyed store that lets a scheduled script (e.g. the
 * Garmin puller in scripts/garmin_to_dashboard.py) push daily health
 * summaries, which the dashboard then pulls in on load and merges into
 * its local health log.
 *
 * Why its own Worker (not the sync store): the cross-device sync store
 * holds a whole-state snapshot with last-write-wins. A script writing a
 * partial payload there would clobber every other tile. This store is
 * scoped to health only and keyed by a secret token, so a script write
 * can never disturb the rest of the dashboard.
 *
 * Data model: one KV value per token, `days:<token>` -> { "YYYY-MM-DD": {entry}, ... },
 * capped to the most recent MAX_DAYS. The token is both identity and secret
 * (same idea as the sync code) — pick something long and random.
 *
 * Endpoints (CORS-open so the browser dashboard can read):
 *   GET  /health   header X-Health-Token: <token>   -> { days:{...} }
 *   POST /health   header X-Health-Token: <token>
 *        body { days:[ {date,...}, ... ] }  OR a single { date,... }  -> { ok, stored, total }
 *   DELETE /health header X-Health-Token: <token>    -> { ok } (wipes this token's data)
 *
 * Setup (see worker/README-deploy.md):
 *   - KV namespace bound as  HEALTH
 *   - Deploy with wrangler; no secrets required (the token lives in the data key).
 */

const MAX_DAYS = 180;
const MAX_BODY_BYTES = 256 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Health-Token",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

/* A token must look deliberate: 8+ chars, url-safe. Keeps junk keys out of KV. */
const validToken = t => typeof t === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(t);

/* Accept only YYYY-MM-DD or DD/MM/YYYY; return the ISO form or null. */
function isoDate(value) {
  const s = String(value || "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return null;
}

/* Keep the newest MAX_DAYS entries by date. */
function capDays(map) {
  const keys = Object.keys(map).sort();
  if (keys.length <= MAX_DAYS) return map;
  const keep = keys.slice(keys.length - MAX_DAYS);
  const out = {};
  keep.forEach(k => { out[k] = map[k]; });
  return out;
}

const tokenOf = (request, url) =>
  request.headers.get("X-Health-Token") || url.searchParams.get("token") || "";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname !== "/health") {
      return json({ ok: true, service: "fefe-health", endpoints: ["GET /health", "POST /health", "DELETE /health"] });
    }

    const token = tokenOf(request, url);
    if (!validToken(token)) return json({ error: "missing or malformed token" }, 401);
    const dataKey = "days:" + token;

    if (request.method === "GET") {
      const raw = await env.HEALTH.get(dataKey);
      return json({ days: raw ? JSON.parse(raw) : {} });
    }

    if (request.method === "DELETE") {
      await env.HEALTH.delete(dataKey);
      return json({ ok: true });
    }

    if (request.method === "POST") {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
      let payload;
      try { payload = JSON.parse(new TextDecoder().decode(buf)); }
      catch { return json({ error: "invalid JSON" }, 400); }

      const incoming = Array.isArray(payload) ? payload
        : Array.isArray(payload && payload.days) ? payload.days
        : [payload];

      const existing = JSON.parse((await env.HEALTH.get(dataKey)) || "{}");
      let stored = 0;
      for (const row of incoming) {
        if (!row || typeof row !== "object") continue;
        const key = isoDate(row.date || row.day || row.calendarDate);
        if (!key) continue;
        existing[key] = { ...(existing[key] || {}), ...row, date: key };
        stored++;
      }
      if (!stored) return json({ error: "no readable day (need a date field)" }, 400);

      const capped = capDays(existing);
      await env.HEALTH.put(dataKey, JSON.stringify(capped));
      return json({ ok: true, stored, total: Object.keys(capped).length });
    }

    return json({ error: "method not allowed" }, 405);
  },
};
