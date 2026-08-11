// src/index.js  —  fefe-sync worker (sync + RSS proxy + shared community content)
//
// UNCHANGED: /data (cross-device sync) and /rss (feed proxy) and __html__ fallback.
// ADDED:     /shared            -> the day's communal tiles, generated ONCE server-side
//            /shared/regenerate -> owner-only force refresh (needs ?token= if ADMIN_TOKEN set)
//            scheduled()        -> daily cron that pre-generates the communal tiles
//
// Reuses the existing SYNC KV binding and ANTHROPIC_API_KEY secret. New KV keys are
// namespaced `shared:*` so they never collide with the `dashboard:<code>` sync blobs.

/* ---------------- shared-content config ---------------- */
var SHARED_KEYS = ["word", "worth", "spanish", "music", "world", "brainflex", "philo", "gmat"];
var MODEL = "claude-haiku-4-5-20251001";
var TZ = "Europe/Paris"; // the shared "day" flips at local midnight here
var RSS_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.skynews.com/feeds/rss/world.xml",
  "https://www.france24.com/en/rss"
];

function sharedCors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Code, Authorization"
  };
}
function sharedJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...sharedCors() } });
}
function authEmail(value) { return String(value || "").trim().toLowerCase(); }
async function authHash(email, password, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${email}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function authToken() { return crypto.randomUUID().replaceAll("-", ""); }
async function authAccount(env, request) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const email = await env.SYNC.get(`auth:session:${token}`);
  return email ? { email } : null;
}
function sharedDayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}
function extractJSON(text) {
  if (!text) return null;
  let t = text.replace(/```json|```/g, "").trim();
  const starts = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  const a = starts.length ? Math.min(...starts) : -1;
  const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
async function callClaude(env, system, user, max = 600) {
  const body = { model: MODEL, max_tokens: max, system, messages: [{ role: "user", content: user }] };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

/* ---------------- per-key generators (prompts mirror the client) ---------------- */
var sharedGen = {
  word: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `One moderately uncommon but useful English word a curious bilingual reader probably doesn't know, with its French equivalent and a quick synonym quiz. Avoid: ${avoid.join(", ") || "none"}. Shape:{"term_en":"","ipa":"","pos":"","def_en":"","term_fr":"","def_fr":"","quiz":{"options":["","","",""],"answer":0,"alt_prompts":["","",""]}}. Exactly one option is the closest synonym. Every option must be a familiar everyday word, so the quiz tests the new word rather than four obscure words. Distractors remain meaningfully close. Provide 3 short alternative prompts. Defs under 12 words.`, 400).then(extractJSON),

  worth: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown. Select intrinsically useful material whose importance follows naturally from accurate explanation, never from a forced analogy or post-hoc connection. Quiz questions should require a small inference using only material taught in the lesson; do not introduce a new fact or concept.",
    `Write a short daily LESSON in story format. Goal: over many days, make the reader knowledgeable about EVERYTHING — rotate freely across ALL domains (hard sciences, mathematics, medicine, economics, finance, geopolitics, geography, world history, philosophy, psychology, art, architecture, music theory, literature, linguistics, law, technology, engineering, astronomy, ecology, anthropology…). CALIBRATE DIFFICULTY: assume a smart, curious 24-year-old business student who reads the news — skip what such a person already knows (no famous facts everyone learned at school), but stay broadly useful, never niche trivia. The sweet spot: important mechanisms, events, and concepts an educated adult plausibly hasn't mastered. Choose a domain clearly different from these recent lessons: ${(avoid || []).join(" | ") || "none"}. Exactly 2 short paragraphs (~110 words total) separated by \\n\\n, vivid and concrete. Then a one-line memorable insight and a 2-question quiz. Shape:{"title":"","category":"","story":"","insight":"","quiz":[{"prompt":"","options":["","",""],"answer":0,"explain":"","alt_prompts":["",""]},{"prompt":"","options":["","",""],"answer":0,"explain":"","alt_prompts":["",""]}]}. Quiz rules: make each question genuinely difficult through close conceptual distinctions or a small inference using only the lesson. Every prompt is at most 18 words. Every option is a parallel phrase of 2–5 words and at most 28 characters. Wrong options must be plausible and closely related, never absurd or off-topic. Each "explain" one sentence; "answer" is the correct option index. "alt_prompts" are 2 alternative rewordings of the same question, used later for spaced recall.`, 1050).then(extractJSON),

  spanish: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `Crea UN ejercicio diario ESCRITO de español (nada de hablar en voz alta) para un estudiante de nivel intermedio-alto (B1–B2, NO bilingüe): debe construir vocabulario y gramática útiles para conversar. TODO en español, con frases claras y sencillas. Varía el tema cada día; evita estos temas recientes: ${(avoid || []).join(" | ") || "none"}. Contenido: un "punto" de gramática o de uso explicado en 2–3 frases simples con un ejemplo, 3 palabras/expresiones de "vocab" útiles en conversación (con traducción corta al inglés), y un "quiz" de 2 preguntas en español. IMPORTANTE: cada pregunta del quiz debe ser una frase que use NATURALMENTE al menos una de las 3 palabras/expresiones de "vocab" en su propio contexto (no solo preguntar su significado aislado) — por ejemplo completar la frase, elegir el tiempo verbal correcto, o el sinónimo adecuado, siempre dentro de una oración que contenga el vocab enseñado, así el estudiante ve cómo se usa de verdad. Shape:{"tema":"","punto":"","vocab":[{"es":"","en":""},{"es":"","en":""},{"es":"","en":""}],"quiz":[{"prompt":"","options":["","",""],"answer":0,"explain":""},{"prompt":"","options":["","",""],"answer":0,"explain":""}]}. Cada "explain" es una frase sencilla en español.`, 650).then(extractJSON),

  music: async (env, avoid) => {
    const base = await callClaude(env, "You output ONLY valid minified JSON, no markdown.",
      `Recommend ONE specific, real recording that is critically or technically excellent yet UNDERRATED — most people don't know it, but a musicologist or serious critic would admire its craft, innovation, influence or musicianship. ROTATE THE GENRE FAMILY EVERY DAY across the whole world of music — e.g. soul, West African highlife, chamber pop, modal jazz, flamenco, qawwali, bossa nova, baroque, gospel, Afrobeat, country, funk, folk, chanson, R&B, string quartet, singer-songwriter, dub, post-punk. IMPORTANT: do NOT default to ambient, minimalist, drone, or experimental/electronic music — those are massively overused in these picks; unless it is genuinely the single best choice, prefer music with melody, voice, or acoustic instrumentation. Pick a genre from a clearly DIFFERENT family than EACH recent pick listed below (each shows its genre in brackets). It MUST be findable as a track in Apple Music. Give the exact released track title. "artist" is the complete recording credit (all named performers, ensemble and/or conductor as appropriate), not automatically the composer and not artificially reduced to one person. For classical music, include the work's composer separately in "composer"; otherwise "composer" may be empty. Avoid anything mainstream or famous, and do NOT repeat: ${avoid.join(" | ") || "none"}. Shape:{"title":"","artist":"","composer":"","year":"","genre":"","why":""}. "genre" is the specific style; "why" (max 18 words) says what makes it special and why it's overlooked.`, 420).then(extractJSON);
    if (!base || !base.title) return base;
    const match = await resolveMusic(base).catch(() => null);
    return match ? { ...base, ...match } : base;
  },

  world: async (env, avoid) => {
    const items = await fetchSharedRss();
    if (!items || !items.length) return null;
    const raw = items.slice(0, 16).map((it, i) => `${i + 1}. ${it.title} — ${it.desc}`).join("\n");
    const out = await callClaude(env, "You output ONLY a valid JSON array, no markdown.",
      `Here are today's raw news headlines from several wire services (may include near-duplicates covering the same event):\n${raw}\n\nPick the 5 most important DISTINCT stories — if two items describe the same event, count that as one. Avoid re-covering stories already picked recently: ${(avoid || []).join(" | ") || "none"}. For each pick write a "headline" (max 9 words, your own words) and a "summary" (2-3 sentences) covering what happened AND why it matters, using only the information given above. Do not end the summary with a generic closing line that just restates the obvious (e.g. "this shows/highlights/underscores…") — add a closing thought only if it's genuinely non-obvious insight; otherwise stop after the facts. Plain prose only — NO markdown, NO citation numbers, NO URLs, NO special symbols. JSON array of {"headline":"","summary":""}.`, 950);
    const arr = extractJSON(out);
    return Array.isArray(arr) ? arr : null;
  },

  brainflex: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `Create ONE hard, self-contained thinking game for a smart 24-year-old. It must be playable mentally or by choosing or manipulating a few options, never an essay or writing exercise. Vary sharply from recent formats: ${(avoid || []).join(" | ") || "none"}. Choose among logic grids, sequences, spatial reasoning, probability traps, deduction, counterfactual choices, ranking constraints, code-breaking, mental maths or lateral riddles. Vary domain and reasoning skill. Shape:{"format":"2-4 word game name","prompt":"concise challenge with all needed information and no hint","solution":"worked answer or decisive insight"}.`, 500).then(extractJSON),

  philo: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `Pick ONE deep contested philosophical question beyond introductory level. Assume solid basics and some primary-text familiarity. Vary among mind, epistemology, meta-ethics, freedom, politics, language, aesthetics and science. Avoid: ${(avoid || []).join(" | ") || "none"}. Shape:{"theme":"2-4 word tag","question":"one or two concise sentences posed directly, retaining genuine depth"}.`, 220).then(extractJSON),

  gmat: (env, avoid) => callClaude(env,
    "You are a meticulous GMAT item writer. You output ONLY a valid minified JSON array, no markdown. Accuracy of the answer key is paramount: solve every question yourself step by step BEFORE writing options, make sure EXACTLY ONE option is correct, and set \"answer\" to that option's 0-based index. If unsure a question is airtight, replace it with a simpler one you can fully verify.",
    `Write today's GMAT practice lesson: 6 fresh, original, self-contained multiple-choice questions for a serious test-taker — 2 Quantitative Reasoning ("quant"), 2 Verbal Reasoning ("verbal"), and 2 Data Insights ("data"). Cover a spread of skills and vary from recent lessons; avoid re-using these skills/topics: ${(avoid || []).join(" | ") || "none"}. Requirements: each question fully self-contained (all data needed is in the prompt — no external tables/images); realistic GMAT difficulty (medium-to-hard); 5 options for quant and data, 4 or 5 for verbal; distractors must be plausible and reflect real mistakes, never absurd. Verbal = critical reasoning or reading-style inference stated inline. Data Insights = quantitative reasoning over numbers given in the prompt (two-part, table-style described in words, or data sufficiency). Each "explain" is 1-2 sentences giving the decisive reasoning. Output a JSON array of exactly 6 objects, each: {"section":"quant|verbal|data","skill":"3-5 word skill tag","type":"e.g. Problem solving / Critical reasoning / Data sufficiency","target":seconds_as_integer,"prompt":"","options":["",""],"answer":0,"explain":""}. "target" is a realistic per-question time in seconds (quant ~120, verbal ~110, data ~135).`,
    2200).then(extractJSON).then((a) => Array.isArray(a) ? a : null)
};

var sharedHistLabel = {
  word: (v) => v && v.term_en,
  worth: (v) => v && v.title,
  spanish: (v) => v && v.tema,
  music: (v) => v && `${v.title} — ${v.artist} [${v.genre || "?"}]`,
  world: (v) => Array.isArray(v) ? v.map((x) => x.headline) : null,
  brainflex: (v) => v && v.format,
  philo: (v) => v && v.theme,
  gmat: (v) => Array.isArray(v) ? v.map((x) => x && x.skill).filter(Boolean) : null
};

/* ---------------- news (server-side RSS, no CORS) ---------------- */
async function fetchSharedRss() {
  const per = await Promise.allSettled(RSS_FEEDS.map(async (url) => {
    const r = await fetch(url, { headers: { "user-agent": "fefe-dashboard/1.0" } });
    if (!r.ok) throw new Error("feed " + r.status);
    const text = await r.text();
    const items = [];
    const re = /<item[\s\S]*?<\/item>/g;
    let m;
    while ((m = re.exec(text)) && items.length < 10) {
      const block = m[0];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim();
      const desc = (block.match(/<description>([\s\S]*?)<\/description>/) || [, ""])[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim();
      if (title) items.push({ title, desc });
    }
    return items;
  }));
  const all = [], seen = /* @__PURE__ */ new Set();
  per.forEach((r) => { if (r.status === "fulfilled") r.value.forEach((it) => {
    const k = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 6).join(" ");
    if (k && !seen.has(k)) { seen.add(k); all.push(it); }
  }); });
  return all.length ? all : null;
}

/* ---------------- iTunes match for the music link (free, no key) ---------------- */
var mNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
var M_NOISE = /* @__PURE__ */ new Set(["a", "an", "the", "and", "feat", "featuring", "with", "version", "edit", "remaster", "remastered", "mono", "stereo"]);
var mTokens = (s) => new Set(mNorm(s).split(/\s+/).filter((w) => w && !M_NOISE.has(w)));
function mOverlap(a, b) { const aa = mTokens(a), bb = mTokens(b); if (!aa.size || !bb.size) return 0; let h = 0; aa.forEach((w) => { if (bb.has(w)) h++; }); return h / Math.max(aa.size, bb.size); }
async function resolveMusic(m) {
  const title = String(m.title || "").trim(), artist = String(m.artist || "").trim(), composer = String(m.composer || "").trim();
  if (!title) return null;
  const queries = [`${title} ${artist} ${composer}`, `${title} ${artist}`, `${title} ${composer}`].map((q) => q.trim()).filter((q, i, a) => q && a.indexOf(q) === i);
  const cand = /* @__PURE__ */ new Map();
  for (const q of queries) {
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=au&media=music&entity=song&limit=25`);
      if (!r.ok) continue;
      const d = await r.json();
      (d.results || []).forEach((t) => { if (t.trackViewUrl) cand.set(String(t.trackId || t.trackViewUrl), t); });
    } catch {}
  }
  const wantCredit = [artist, composer].filter(Boolean).join(" ");
  const scored = [...cand.values()].map((t) => {
    const wanted = mNorm(title), found = mNorm(t.trackName);
    const titleScore = wanted === found ? 100 : (wanted && found && (wanted.includes(found) || found.includes(wanted)) ? 88 : mOverlap(title, t.trackName) * 80);
    const credits = [t.artistName, t.composerName, t.collectionArtistName].filter(Boolean).join(" ");
    const wc = mNorm(wantCredit), fc = mNorm(credits);
    const creditScore = !wc ? 12 : (wc === fc ? 38 : (wc.includes(fc) || fc.includes(wc) ? 32 : mOverlap(wantCredit, credits) * 30));
    return { t, titleScore, creditScore, score: titleScore + creditScore };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.titleScore < 70 || best.creditScore < 10) return null;
  return { url: best.t.trackViewUrl, trackId: best.t.trackId || "", catalogTitle: best.t.trackName || title, catalogArtist: best.t.artistName || artist, catalogComposer: best.t.composerName || composer, catalogMatched: true };
}

/* Which shared tiles to actually generate. Set the `SHARED_TILES` Worker
   variable to a comma-separated list (e.g. "word,gmat") to only spend API
   calls on the tiles you use. Unset/empty = generate everything (default). */
function activeSharedKeys(env) {
  const raw = (env && env.SHARED_TILES) ? String(env.SHARED_TILES) : "";
  const wanted = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return SHARED_KEYS;
  const filtered = SHARED_KEYS.filter((k) => wanted.includes(k));
  return filtered.length ? filtered : SHARED_KEYS;
}

/* ---------------- generate + cache the whole day (namespaced in SYNC KV) ---------------- */
async function generateSharedDay(env, date) {
  const keys = activeSharedKeys(env);
  const hist = JSON.parse((await env.SYNC.get("shared_history")) || "{}");
  const results = await Promise.all(keys.map((k) => {
    const avoid = (hist[k] || []).slice(-20);
    return sharedGen[k](env, avoid).catch(() => null);
  }));
  const content = {};
  keys.forEach((k, i) => { if (results[i]) content[k] = results[i]; });
  keys.forEach((k, i) => {
    const v = results[i]; if (!v) return;
    const lab = sharedHistLabel[k] ? sharedHistLabel[k](v) : null;
    if (!lab) return;
    hist[k] = [...(hist[k] || []), ...(Array.isArray(lab) ? lab : [lab])].slice(-40);
  });
  await env.SYNC.put("shared:" + date, JSON.stringify(content));
  await env.SYNC.put("shared_history", JSON.stringify(hist));
  return content;
}

/* ================= worker ================= */
var index_default = {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      // Authorization must be allowed here or the browser blocks every
      // authenticated request (account data sync, password, delete) at the
      // CORS preflight with a "Load failed" network error.
      "Access-Control-Allow-Headers": "Content-Type, X-Sync-Code, Authorization"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);

    // ---- shared community content (new) ----
    if (url.pathname === "/shared" && request.method === "GET") {
      const date = url.searchParams.get("date") || sharedDayKey();
      let raw = await env.SYNC.get("shared:" + date);
      if (!raw && date === sharedDayKey()) {
        const locked = await env.SYNC.get("shared_lock:" + date);
        if (!locked) {
          await env.SYNC.put("shared_lock:" + date, "1", { expirationTtl: 120 });
          try { const content = await generateSharedDay(env, date); raw = JSON.stringify(content); }
          finally { await env.SYNC.delete("shared_lock:" + date); }
        }
      }
      return sharedJson({ date, content: raw ? JSON.parse(raw) : null });
    }
    if (url.pathname === "/shared/regenerate" && request.method === "POST") {
      if (env.ADMIN_TOKEN && url.searchParams.get("token") !== env.ADMIN_TOKEN) return sharedJson({ error: "unauthorized" }, 401);
      const date = sharedDayKey();
      const content = await generateSharedDay(env, date);
      return sharedJson({ date, content });
    }

    // ---- account authentication and account-scoped data ----
    if (url.pathname === "/auth/signup" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const email = authEmail(body.email), password = String(body.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return sharedJson({ error: "Use a valid email and a password of at least 8 characters." }, 400);
      const key = `auth:user:${email}`;
      if (await env.SYNC.get(key)) return sharedJson({ error: "An account with that email already exists." }, 409);
      const salt = authToken(), hash = await authHash(email, password, salt), token = authToken();
      await env.SYNC.put(key, JSON.stringify({ email, salt, hash, createdAt: Date.now() }));
      await env.SYNC.put(`auth:session:${token}`, email, { expirationTtl: 60 * 60 * 24 * 30 });
      return sharedJson({ token, email });
    }
    if (url.pathname === "/auth/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const email = authEmail(body.email), password = String(body.password || ""), record = await env.SYNC.get(`auth:user:${email}`, "json");
      if (!record || !(await authHash(email, password, record.salt) === record.hash)) return sharedJson({ error: "Email or password is incorrect." }, 401);
      const token = authToken(); await env.SYNC.put(`auth:session:${token}`, email, { expirationTtl: 60 * 60 * 24 * 30 });
      return sharedJson({ token, email });
    }
    if (url.pathname === "/auth/me" && request.method === "GET") {
      const account = await authAccount(env, request); return account ? sharedJson(account) : sharedJson({ error: "Not signed in" }, 401);
    }
    if (url.pathname === "/auth/password" && request.method === "POST") {
      const account = await authAccount(env, request); if (!account) return sharedJson({ error: "Not signed in" }, 401);
      const body = await request.json().catch(() => ({})), nextPassword = String(body.password || "");
      if (nextPassword.length < 8) return sharedJson({ error: "Password must be at least 8 characters." }, 400);
      const key = `auth:user:${account.email}`, record = await env.SYNC.get(key, "json"); if (!record) return sharedJson({ error: "Account not found." }, 404);
      const salt = authToken(); record.salt = salt; record.hash = await authHash(account.email, nextPassword, salt); await env.SYNC.put(key, JSON.stringify(record));
      return sharedJson({ ok: true });
    }
    if (url.pathname === "/auth/delete" && request.method === "POST") {
      const account = await authAccount(env, request); if (!account) return sharedJson({ error: "Not signed in" }, 401);
      await env.SYNC.delete(`auth:user:${account.email}`); await env.SYNC.delete(`account:${account.email}`);
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim(); if (token) await env.SYNC.delete(`auth:session:${token}`);
      return sharedJson({ ok: true });
    }
    if (url.pathname === "/account/data") {
      const account = await authAccount(env, request); if (!account) return sharedJson({ error: "Not signed in" }, 401);
      const key = `account:${account.email}`;
      if (request.method === "GET") return sharedJson(await env.SYNC.get(key, "json") || { updatedAt: 0, data: {} });
      if (request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return sharedJson({ error: "Invalid data" }, 400);
        // Refuse stale writes: an older push must never overwrite a newer stored version.
        const current = await env.SYNC.get(key, "json");
        const stored = current && Number(current.updatedAt || 0);
        const incoming = Number(body.updatedAt || 0);
        if (stored && incoming < stored) return sharedJson({ ok: true, stored: false, updatedAt: stored });
        await env.SYNC.put(key, JSON.stringify(body));
        return sharedJson({ ok: true, stored: true, updatedAt: incoming });
      }
      return sharedJson({ error: "Method not allowed" }, 405);
    }
    // ---- cross-device sync (legacy sync-code compatibility) ----
    if (url.pathname === "/data") {
      const code = request.headers.get("X-Sync-Code");
      if (!code || code.length < 6) {
        return new Response(JSON.stringify({ error: "Missing or invalid sync code" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...cors }
        });
      }
      const key = `dashboard:${code}`;
      if (request.method === "GET") {
        const value = await env.SYNC.get(key);
        return new Response(value || "null", { headers: { "Content-Type": "application/json", ...cors } });
      }
      if (request.method === "POST") {
        const body = await request.text();
        await env.SYNC.put(key, body);
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...cors } });
      }
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    // ---- RSS proxy (unchanged) ----
    if (url.pathname === "/rss") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("Missing url", { status: 400, headers: cors });
      let host = "";
      try {
        host = new URL(target).host;
      } catch {
        return new Response("Bad url", { status: 400, headers: cors });
      }
      const allow = ["feeds.bbci.co.uk", "feeds.skynews.com", "www.france24.com", "www.aljazeera.com", "rss.nytimes.com", "feeds.npr.org"];
      if (!allow.some((h) => host === h || host.endsWith("." + h))) {
        return new Response("Host not allowed", { status: 403, headers: cors });
      }
      try {
        const upstream = await fetch(target, { headers: { "User-Agent": "DashboardRSS/1.0" } });
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: { "Content-Type": "application/xml; charset=utf-8", ...cors }
        });
      } catch (e) {
        return new Response("Upstream error", { status: 502, headers: cors });
      }
    }

    // ---- __html__ fallback (unchanged) ----
    if (request.method === "GET") {
      const html = await env.SYNC.get("__html__");
      if (html) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response("Dashboard not uploaded yet — run the kv put command.", { status: 404 });
    }
    return new Response("Not found", { status: 404, headers: cors });
  },

  // daily pre-generation of the communal tiles
  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateSharedDay(env, sharedDayKey()));
  }
};
export {
  index_default as default
};
