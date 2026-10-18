// src/index.js  —  fefe-sync worker (sync + RSS proxy + shared community content)
//
// UNCHANGED: /data (cross-device sync) and /rss (feed proxy) and __html__ fallback.
// ADDED:     /shared            -> the day's communal tiles, generated ONCE server-side
//            /shared/retry      -> fill missing tiles; successful content never changes
//            /shared/regenerate -> backwards-compatible safe retry alias
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
// Public page assets only. Never turn a URL into an unrestricted KV lookup.
const DASHBOARD_ASSETS = new Map([
  ["/dashboard.webmanifest", "application/manifest+json; charset=utf-8"],
  ["/assets/icons/favicon-32.png", "image/png"],
  ["/assets/icons/apple-touch-icon.png", "image/png"],
  ["/assets/icons/dashboard-192.png", "image/png"],
  ["/assets/icons/dashboard-512.png", "image/png"],
  ["/assets/icons/dashboard-maskable-512.png", "image/png"]
]);

function sharedCors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Code, Authorization"
  };
}
function sharedJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...sharedCors() } });
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
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) { const error = new Error("API " + res.status); error.status = res.status; throw error; }
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
    if (!items || !items.length) throw dailyFailure("feed_unavailable");
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
    const r = await fetch(url, { headers: { "user-agent": "fefe-dashboard/1.0" }, signal: AbortSignal.timeout(10000) });
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
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=au&media=music&entity=song&limit=25`, { signal: AbortSignal.timeout(4000) });
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

/* Which shared tiles to actually generate, so API tokens aren't spent on tiles
   nobody reads. Precedence:
     1. the `shared_config` KV key {tiles:[...]} — set from the dashboard's
        Settings → "Daily AI content" checklist (per-tile, no Cloudflare edits);
     2. the `SHARED_TILES` Worker variable (comma-separated), as a manual fallback;
     3. DEFAULT_SHARED (word + gmat) when neither is set — a minimal, token-frugal
        default so a fresh deploy never generates tiles nobody asked for. To
        generate everything, set the in-app checklist or SHARED_TILES explicitly. */
const DEFAULT_SHARED = ["word", "gmat"];
async function activeSharedKeys(env) {
  let wanted = null;
  try {
    const c = await env.SYNC.get("shared_config");
    if (c) { const p = JSON.parse(c); if (Array.isArray(p.tiles)) wanted = p.tiles.map((s) => String(s).trim().toLowerCase()).filter(Boolean); }
  } catch (e) {}
  if (!wanted && env && env.SHARED_TILES) wanted = String(env.SHARED_TILES).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!wanted) return SHARED_KEYS.filter((k) => DEFAULT_SHARED.includes(k));
  return SHARED_KEYS.filter((k) => wanted.includes(k));
}

/* ---------------- immutable daily records ---------------- */
const textPresent = v => typeof v === "string" && v.trim().length > 0;
const validQuiz = q => !!q && textPresent(q.prompt) && Array.isArray(q.options) && q.options.length >= 2 && q.options.every(textPresent) && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;
function validDailyContent(key, value) {
  if (!value || typeof value !== "object") return false;
  switch (key) {
    case "word": return textPresent(value.term_en) && textPresent(value.def_en) && textPresent(value.term_fr) && !!value.quiz && Array.isArray(value.quiz.options) && value.quiz.options.length >= 2 && value.quiz.options.every(textPresent) && Number.isInteger(value.quiz.answer) && value.quiz.answer >= 0 && value.quiz.answer < value.quiz.options.length;
    case "worth": return textPresent(value.title) && textPresent(value.story) && Array.isArray(value.quiz) && value.quiz.length > 0 && value.quiz.every(validQuiz);
    case "spanish": return textPresent(value.tema) && textPresent(value.punto) && Array.isArray(value.vocab) && value.vocab.length > 0 && value.vocab.every(v => v && textPresent(v.es) && textPresent(v.en)) && Array.isArray(value.quiz) && value.quiz.length > 0 && value.quiz.every(validQuiz);
    case "music": return textPresent(value.title) && textPresent(value.artist) && textPresent(value.why);
    case "world": return Array.isArray(value) && value.length > 0 && value.every(v => v && textPresent(v.headline) && textPresent(v.summary));
    case "brainflex": return textPresent(value.format) && textPresent(value.prompt) && textPresent(value.solution);
    case "philo": return textPresent(value.theme) && textPresent(value.question);
    case "academic": return textPresent(value.concept) && textPresent(value.explain) && Array.isArray(value.quiz) && value.quiz.length > 0 && value.quiz.every(validQuiz);
    case "gmat": return Array.isArray(value) && value.length > 0 && value.every(q => validQuiz(q) && textPresent(q.explain));
    case "weather": return !!value.tomorrow && [value.temp, value.code, value.hi, value.lo, value.tomorrow.hi, value.tomorrow.lo, value.tomorrow.code].every(v => typeof v === "number" && Number.isFinite(v)) && textPresent(value.place);
    default: return false;
  }
}
function parseObject(value) {
  try { const result = typeof value === "string" ? JSON.parse(value) : value; return result && typeof result === "object" && !Array.isArray(result) ? result : {}; } catch { return {}; }
}
function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || "") && !Number.isNaN(Date.parse(date + "T12:00:00Z")) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
}
function canGenerateDate(date) {
  // A profile's 01:00 logical rollover can be either side of the server's day.
  return validDate(date) && Math.abs(Date.parse(date + "T12:00:00Z") - Date.now()) <= 36 * 60 * 60 * 1000;
}
function dailyFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function protectedDailyStorage(storage) {
  const guarded = {};
  for (const method of ["get", "put", "deleteAll"]) {
    guarded[method] = async (...args) => {
      try { return await storage[method](...args); }
      catch { throw dailyFailure("server_storage_error"); }
    };
  }
  return guarded;
}
function generationError(error) {
  if (error && [401, 403].includes(error.status)) return { state: "invalid_key", message: "The API key was rejected. Update it before retrying." };
  if (error && error.status === 429) return { state: "rate_limit", message: "The content service reached its request limit. Wait a moment, then retry. Saved tiles are kept." };
  if (error && error.status >= 500) return { state: "service_error", message: "The content provider is temporarily unavailable. Try again later. Saved tiles are kept." };
  if (error && (error.code === "invalid_content" || error instanceof SyntaxError)) return { state: "invalid_content", message: "The service returned incomplete content. Retry this tile; saved tiles are kept." };
  if (error && error.code === "feed_unavailable") return { state: "feed_unavailable", message: "The news sources are unavailable. Try again later; no stories have been invented." };
  if (error && ["AbortError", "TimeoutError"].includes(error.name)) return { state: "service_error", message: "The content service timed out. Retry later; saved tiles are kept." };
  if (error && error.status) return { state: "service_error", message: "The content provider rejected the request. Check the service setup, then retry." };
  return { state: "error", message: "Today's content could not be loaded. Retry keeps every tile already loaded." };
}
function sharedResult(date, record, keys, fallback) {
  const content = {}, status = {};
  SHARED_KEYS.forEach(key => {
    if (validDailyContent(key, record.content && record.content[key])) {
      content[key] = record.content[key]; status[key] = { state: "ready" };
    } else if (!keys.includes(key)) status[key] = { state: "disabled", message: "Enable this tile in Settings → Daily content." };
    else status[key] = record.status && record.status[key] || fallback || { state: "missing", message: "Today's content has not loaded yet." };
  });
  return { date, content, status, frozen: true, retryMissingOnly: true };
}
function coordinator(env, name) {
  return env.DAILY_COORDINATOR && env.DAILY_COORDINATOR.get(env.DAILY_COORDINATOR.idFromName(name));
}
async function sharedRequest(env, date, requested, generate = true) {
  const stub = coordinator(env, "shared-daily-v1");
  if (stub) return stub.fetch("https://daily.internal/shared", { method: "POST", body: JSON.stringify({ date, keys: requested, generate }) });
  // KV's eventual consistency cannot enforce a lock. Keep old cache readable,
  // but never spend API calls without the durable coordinator binding.
  const content = parseObject(await env.SYNC.get("shared:" + date));
  const keys = await activeSharedKeys(env);
  return sharedJson(sharedResult(date, { content }, keys, { state: "server_unconfigured", message: "Daily content needs a server update. Your loaded tiles are safe." }));
}
function mergeDailySnapshot(current, incoming) {
  const result = { ...incoming, data: { ...(incoming.data || {}) } };
  const existing = current && current.data || {};
  // Never sync credentials, including snapshots from older clients.
  const privateKeys = ["fefe_apiKey", "fefe_garminKey", "fefe_syncId", "fefe_syncStamp", "fefe_healthToken", "fefe_accountToken"];
  for (const name of new Set([...Object.keys(existing), ...Object.keys(result.data)])) {
    if (!/^fefe_daily:\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    const before = parseObject(existing[name]), after = parseObject(result.data[name]);
    for (const key of [...SHARED_KEYS, "academic", "weather"]) {
      if (validDailyContent(key, before[key])) after[key] = before[key];
      else if (!validDailyContent(key, after[key])) delete after[key];
    }
    result.data[name] = JSON.stringify(after);
  }
  privateKeys.forEach(key => { delete result.data[key]; });
  return result;
}

// One object owns all shared dates; account objects own a person's daily lessons
// and snapshot. The promise queue covers external I/O, where DO input gates alone
// do not prevent a second request from entering. Durable records survive restarts.
class DailyCoordinator {
  constructor(state, env) { this.storage = protectedDailyStorage(state.storage); this.env = env; this.queue = Promise.resolve(); }
  fetch(request) {
    const work = this.queue.then(() => this.handle(request));
    this.queue = work.catch(() => {});
    return work;
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    const body = parseObject(await request.json().catch(() => ({})));
    try {
      if (path === "/shared") return await this.shared(body);
      if (path === "/personal") return await this.personal(body);
      if (path === "/account") return await this.account(body);
      if (path === "/delete") { await this.storage.deleteAll(); return sharedJson({ ok: true }); }
      return sharedJson({ error: "Not found" }, 404);
    } catch (error) {
      if (!error || error.code !== "server_storage_error") throw error;
      const problem = { state: "server_storage_error", message: "The daily server could not access its saved data. Try again later; loaded tiles and progress stay safe." };
      if (path === "/shared" || path === "/personal") {
        const keys = path === "/personal" ? ["academic"] : SHARED_KEYS.filter(key => !Array.isArray(body.keys) || body.keys.includes(key));
        // Never expose an in-memory candidate whose durable commit failed.
        return sharedJson({ date: body.date, content: {}, status: Object.fromEntries(keys.map(key => [key, problem])), frozen: true, retryMissingOnly: true }, 503);
      }
      return sharedJson({ error: problem.message, code: problem.state }, 503);
    }
  }
  async shared({ date, keys: requested, generate }) {
    if (!validDate(date)) return sharedJson({ error: "Invalid date" }, 400);
    const env = this.env, active = await activeSharedKeys(env), storageKey = "day:" + date;
    let record = await this.storage.get(storageKey);
    if (!record) record = { content: parseObject(await env.SYNC.get("shared:" + date)), status: {} };
    record.status = record.status || {};
    const keys = active.filter(key => !Array.isArray(requested) || requested.includes(key));
    let history = await this.storage.get("history") || parseObject(await env.SYNC.get("shared_history"));
    const pending = keys.filter(key => !validDailyContent(key, record.content[key]) && generate && canGenerateDate(date));
    for (const key of pending) record.status[key] = env.ANTHROPIC_API_KEY
      ? { state: "processing", startedAt: Date.now() }
      : { state: "missing_key", message: "The server API key is missing. Your personal API key is not required for this tile." };
    // Reserve the batch before any provider call. Independent tiles can load in
    // parallel; commits stay ordered so a slow tile cannot overwrite its neighbour.
    await this.storage.put(storageKey, record);
    let commits = Promise.resolve();
    const commit = task => { const work = commits.then(task); commits = work.catch(() => {}); return work; };
    const outcomes = await Promise.allSettled((env.ANTHROPIC_API_KEY ? pending : []).map(async key => {
      let value, problem;
      try {
        value = await sharedGen[key](env, (Array.isArray(history[key]) ? history[key] : []).slice(-20));
        if (!validDailyContent(key, value)) throw dailyFailure("invalid_content");
      } catch (error) { problem = generationError(error); }
      await commit(async () => {
        const next = { ...record, content: { ...record.content }, status: { ...record.status, [key]: problem || { state: "ready" } } };
        let nextHistory = history;
        if (!problem) {
          next.content[key] = value;
          const label = sharedHistLabel[key](value);
          nextHistory = { ...history, [key]: [...(Array.isArray(history[key]) ? history[key] : []), ...(Array.isArray(label) ? label : [label]).filter(Boolean)].slice(-40) };
        }
        // Publish only committed content. A failed save never changes the
        // in-memory authority or leaks a candidate through a neighbouring commit.
        await this.storage.put({ [storageKey]: next, history: nextHistory });
        record = next; history = nextHistory;
      });
    }));
    // Wait for every in-flight task before releasing the request queue, including
    // when one commit failed. The next request cannot race unfinished work.
    const failed = outcomes.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
    // Compatibility mirrors are never the authority after migration.
    await env.SYNC.put("shared:" + date, JSON.stringify(record.content)).catch(() => {});
    await env.SYNC.put("shared_history", JSON.stringify(history)).catch(() => {});
    return sharedJson(sharedResult(date, record, active));
  }
  async account({ email, snapshot }) {
    let current = await this.storage.get("account");
    if (!current) current = await this.env.SYNC.get("account:" + email, "json") || { updatedAt: 0, data: {} };
    if (!snapshot) return sharedJson(mergeDailySnapshot(null, current));
    const stored = Number(current.updatedAt || 0), incoming = Number(snapshot.updatedAt || 0);
    if (stored && incoming < stored) return sharedJson({ ok: true, stored: false, updatedAt: stored });
    const next = mergeDailySnapshot(current, snapshot);
    // Personal generation and snapshot sync share the same immutable record.
    for (const name of Object.keys(next.data)) {
      if (!/^fefe_daily:\d{4}-\d{2}-\d{2}$/.test(name)) continue;
      const key = "personal:" + name.slice("fefe_daily:".length), daily = await this.storage.get(key);
      const value = parseObject(next.data[name]);
      if (daily && validDailyContent("academic", daily.content && daily.content.academic)) value.academic = daily.content.academic;
      else if (validDailyContent("academic", value.academic)) await this.storage.put(key, { content: { academic: value.academic }, status: { academic: { state: "ready" } } });
      next.data[name] = JSON.stringify(value);
    }
    await this.storage.put("account", next);
    await this.env.SYNC.put("account:" + email, JSON.stringify(next)).catch(() => {});
    return sharedJson({ ok: true, stored: true, updatedAt: incoming, data: next.data });
  }
  async personal({ email, date, key, apiKey, course, avoid }) {
    if (!validDate(date) || key !== "academic") return sharedJson({ error: "Invalid daily request" }, 400);
    const storageKey = "personal:" + date;
    let record = await this.storage.get(storageKey) || { content: {}, status: {} };
    if (!validDailyContent(key, record.content[key])) {
      const snapshot = await this.storage.get("account") || await this.env.SYNC.get("account:" + email, "json");
      const cached = parseObject(snapshot && snapshot.data && snapshot.data["fefe_daily:" + date]);
      if (validDailyContent(key, cached[key])) record.content[key] = cached[key];
    }
    if (validDailyContent(key, record.content[key])) { await this.storage.put(storageKey, record); return sharedJson({ date, content: record.content, status: { [key]: { state: "ready" } }, frozen: true }); }
    if (!canGenerateDate(date)) record.status[key] = { state: "error", message: "Only the current logical day can be loaded." };
    else if (!textPresent(apiKey)) record.status[key] = { state: "missing_key", message: "Add your Anthropic API key in Settings to load Academic." };
    else if (!course || !textPresent(course.id) || !textPresent(course.name) || !textPresent(course.content)) record.status[key] = { state: "missing_course", message: "Add course notes before loading Academic." };
    else {
      record.status[key] = { state: "processing", startedAt: Date.now() };
      await this.storage.put(storageKey, record);
      try {
        const value = extractJSON(await callClaude({ ANTHROPIC_API_KEY: apiKey }, "You output ONLY valid minified JSON, no markdown.",
          `Build one day's exam-prep study capsule from the student's own notes. Teach one concept in 3–4 sentences and connect it to the broader chapter in 1–2 sentences. Use only the supplied notes. Avoid: ${(Array.isArray(avoid) ? avoid : []).slice(-12).join(" | ") || "none"}. Course: ${String(course.name).slice(0,160)}. Notes: ${String(course.content).slice(0,6000)}. Shape:{"concept":"","explain":"","bigPicture":"","quiz":[{"prompt":"","options":["","",""],"answer":0,"explain":""},{"prompt":"","options":["","",""],"answer":0,"explain":""}]}. Test understanding; make distractors plausible.`, 900));
        if (!validDailyContent(key, value)) throw dailyFailure("invalid_content");
        record.content[key] = { ...value, courseId: course.id, courseName: course.name };
        record.status[key] = { state: "ready" };
      } catch (error) { record.status[key] = generationError(error); }
    }
    await this.storage.put(storageKey, record);
    // The supplied key and course notes are request-scoped and never persisted.
    return sharedJson({ date, content: record.content, status: record.status, frozen: true });
  }
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

    if (request.method === "GET" && (DASHBOARD_ASSETS.has(url.pathname) || url.pathname.startsWith("/assets/") || url.pathname.endsWith(".webmanifest"))) {
      const mime = DASHBOARD_ASSETS.get(url.pathname);
      const missing = () => new Response("Asset not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...cors } });
      if (!mime) return missing();
      const asset = await env.SYNC.get("asset:" + url.pathname, "arrayBuffer");
      if (asset === null || asset === undefined) return missing();
      return new Response(asset, { headers: { "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300", ...cors } });
    }

    // ---- shared community content (new) ----
    if (url.pathname === "/shared" && request.method === "GET") {
      const date = url.searchParams.get("date") || sharedDayKey();
      if (!validDate(date)) return sharedJson({ error: "Invalid date" }, 400);
      return sharedRequest(env, date, null);
    }
    if (["/shared/retry", "/shared/regenerate"].includes(url.pathname) && request.method === "POST") {
      if (url.pathname === "/shared/regenerate" && env.ADMIN_TOKEN && url.searchParams.get("token") !== env.ADMIN_TOKEN) return sharedJson({ error: "unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const date = url.searchParams.get("date") || body.date || sharedDayKey();
      if (!validDate(date)) return sharedJson({ error: "Invalid date" }, 400);
      return sharedRequest(env, date, Array.isArray(body.keys) ? body.keys.filter(k => SHARED_KEYS.includes(k)) : null);
    }
    // Which shared tiles to generate daily — driven by the dashboard's
    // Settings → "Daily AI content" checklist so tokens aren't spent on
    // tiles nobody reads.
    if (url.pathname === "/shared/config" && request.method === "GET") {
      const c = await env.SYNC.get("shared_config");
      return sharedJson({ tiles: c ? (parseObject(c).tiles || null) : null, active: await activeSharedKeys(env), all: SHARED_KEYS, safeRetry: !!env.DAILY_COORDINATOR });
    }
    if (url.pathname === "/shared/config" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const tiles = Array.isArray(body.tiles)
        ? body.tiles.map((s) => String(s).trim().toLowerCase()).filter((k) => SHARED_KEYS.includes(k))
        : null;
      await env.SYNC.put("shared_config", JSON.stringify({ tiles }));
      return sharedJson({ ok: true, tiles });
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
      const stub = coordinator(env, "account:" + account.email);
      if (stub) await stub.fetch("https://daily.internal/delete", { method: "POST", body: "{}" });
      await env.SYNC.delete(`auth:user:${account.email}`); await env.SYNC.delete(`account:${account.email}`);
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim(); if (token) await env.SYNC.delete(`auth:session:${token}`);
      return sharedJson({ ok: true });
    }
    if (url.pathname === "/daily/personal" && request.method === "POST") {
      const account = await authAccount(env, request); if (!account) return sharedJson({ error: "Not signed in" }, 401);
      const body = await request.json().catch(() => ({}));
      const stub = coordinator(env, "account:" + account.email);
      if (!stub) return sharedJson({ date: body.date, content: {}, status: { academic: { state: "server_unconfigured", message: "Academic needs the daily-content server update. Your loaded tiles are safe." } } }, 503);
      return stub.fetch("https://daily.internal/personal", { method: "POST", body: JSON.stringify({ date: body.date, key: body.key, apiKey: body.apiKey, course: body.course, avoid: body.avoid, email: account.email }) });
    }
    if (url.pathname === "/account/data") {
      const account = await authAccount(env, request); if (!account) return sharedJson({ error: "Not signed in" }, 401);
      const key = `account:${account.email}`;
      const stub = coordinator(env, "account:" + account.email);
      if (request.method === "GET") {
        if (stub) return stub.fetch("https://daily.internal/account", { method: "POST", body: JSON.stringify({ email: account.email }) });
        return sharedJson(mergeDailySnapshot(null, await env.SYNC.get(key, "json") || { updatedAt: 0, data: {} }));
      }
      if (request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || !body.data || typeof body.data !== "object" || Array.isArray(body.data) || !Number.isFinite(Number(body.updatedAt))) return sharedJson({ error: "Invalid data" }, 400);
        if (stub) return stub.fetch("https://daily.internal/account", { method: "POST", body: JSON.stringify({ email: account.email, snapshot: body }) });
        // Refuse stale writes: an older push must never overwrite a newer stored version.
        const current = await env.SYNC.get(key, "json");
        const stored = current && Number(current.updatedAt || 0);
        const incoming = Number(body.updatedAt || 0);
        if (stored && incoming < stored) return sharedJson({ ok: true, stored: false, updatedAt: stored });
        await env.SYNC.put(key, JSON.stringify(mergeDailySnapshot(current, body)));
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
      if (html) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      return new Response("Dashboard not uploaded yet — run the kv put command.", { status: 404 });
    }
    return new Response("Not found", { status: 404, headers: cors });
  },

  // daily pre-generation of the communal tiles
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sharedRequest(env, sharedDayKey(), null));
  }
};
export {
  index_default as default,
  DailyCoordinator
};
