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
var SHARED_KEYS = ["word", "worth", "spanish", "german", "music", "world", "brainflex", "philo"];
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
async function authHash(email, password, salt, version) {
  if (version === "pbkdf2-sha256-v1") {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt + ":" + email), iterations: 100000 }, key, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const bytes = new TextEncoder().encode(`${salt}:${email}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function authToken() { return crypto.randomUUID().replaceAll("-", ""); }
async function authAccount(env, request) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const response = await authService(env, "session", { token });
    if (response.ok) return await response.json();
    return response.status === 401 ? null : { unavailable: true, response };
  } catch { return { unavailable: true, response: sharedJson({ error: "The account service is temporarily unavailable. Please try again.", code: "auth_service_unavailable" }, 503) }; }
}

/* Password recovery and credentials share one serialized, durable authority.
   Legacy credentials/sessions import on first use; dashboard snapshots stay separate. */
const AUTH_RESET_TTL = 20 * 60 * 1000;
const AUTH_SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const AUTH_RECOVERY_MESSAGE = "Recovery requested. If an account uses that email, look for a reset link in your inbox and spam folder.";
const AUTH_APP_DEFAULT = "https://fefe-sync.fefedashboard.workers.dev/";
const authValidEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const authValidPassword = password => typeof password === "string" && password.length >= 8 && password.length <= 256;
async function authDigest(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function authResetToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function authPasswordRecord(email, password, before = {}) {
  const salt = authResetToken();
  return { ...before, email, salt, hash: await authHash(email, password, salt, "pbkdf2-sha256-v1"), hashVersion: "pbkdf2-sha256-v1" };
}
function recoveryAvailable(env) { return !!(env.AUTH_EMAIL_FROM && (env.AUTH_EMAIL?.send || env.RESEND_API_KEY)); }
function recoveryAppURL(env) {
  const url = new URL(env.AUTH_APP_URL || AUTH_APP_DEFAULT);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid recovery origin");
  url.hash = ""; url.search = ""; return url.href;
}
async function sendAuthEmail(env, to, subject, text) {
  const from = String(env.AUTH_EMAIL_FROM || "");
  if (!from || /[\r\n]/.test(from)) throw new Error("Email sender unavailable");
  if (env.AUTH_EMAIL?.send) {
    let timeout;
    try { return await Promise.race([env.AUTH_EMAIL.send({ from, to, subject, text }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Email timeout")), 15000); })]); }
    finally { clearTimeout(timeout); }
  }
  if (!env.RESEND_API_KEY) throw new Error("Email sender unavailable");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Email provider rejected request");
}
async function authBody(request) {
  const text = await request.text();
  if (text.length > 4096) return null;
  try { const body = JSON.parse(text); return body && typeof body === "object" && !Array.isArray(body) ? body : null; } catch { return null; }
}
async function authService(env, op, body) {
  const stub = coordinator(env, "auth-recovery-v1");
  if (!stub) return sharedJson({ error: "Account recovery is temporarily unavailable. Please try again later.", code: "recovery_unavailable" }, 503);
  return stub.fetch("https://daily.internal/auth/" + op, { method: "POST", body: JSON.stringify(body) });
}
class AuthRecovery {
  constructor(storage, env, waitUntil) { this.storage = storage; this.env = env; this.waitUntil = waitUntil; }
  async user(email) {
    const cached = await this.storage.get("auth-user:" + email);
    if (cached !== undefined && cached !== null) return cached.record;
    const record = await this.env.SYNC.get("auth:user:" + email, "json");
    if (record) await this.storage.put("auth-user:" + email, { record });
    return record;
  }
  async saveUser(record) {
    await this.storage.put("auth-user:" + record.email, { record });
    await this.env.SYNC.put("auth:user:" + record.email, JSON.stringify(record)).catch(() => {});
  }
  async session(token) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(token || "")) return null;
    let session = await this.storage.get("auth-session:" + await authDigest(token));
    if (!session) {
      const legacy = await this.env.SYNC.get("auth:session:" + token);
      if (!legacy) return null;
      session = { email: legacy, version: "legacy", expiresAt: Date.now() + AUTH_SESSION_TTL };
    }
    const record = await this.user(session.email);
    if (!record || session.expiresAt <= Date.now() || session.version !== (record.sessionVersion || "legacy")) return null;
    return { email: session.email };
  }
  async newSession(record) {
    const token = authResetToken();
    await this.storage.put("auth-session:" + await authDigest(token), { email: record.email, version: record.sessionVersion || "legacy", expiresAt: Date.now() + AUTH_SESSION_TTL });
    return { token, email: record.email };
  }
  async limit(name, count, duration) {
    const now = Date.now(), key = "auth-rate:" + name;
    let bucket = await this.storage.get(key);
    if (!bucket || bucket.until <= now) bucket = { count: 0, until: now + duration };
    if (bucket.count >= count) return Math.max(1, Math.ceil((bucket.until - now) / 1000));
    await this.storage.put(key, { ...bucket, count: bucket.count + 1 }); return 0;
  }
  async handle(op, body) {
    const email = authEmail(body.email), password = body.password;
    if (op === "session") { const account = await this.session(body.token); return sharedJson(account || { error: "Not signed in" }, account ? 200 : 401); }
    if (op === "signup") {
      const retryAfter = await this.limit("signup-global", 50, 3600000) || await this.limit("signup-ip:" + await authDigest(body.ip || "unknown"), 5, 3600000);
      if (retryAfter) return sharedJson({ error: "Too many account requests. Please try later.", code: "rate_limited", retryAfter }, 429);
      if (!authValidEmail(email) || !authValidPassword(password)) return sharedJson({ error: "Use a valid email and a password of 8–256 characters." }, 400);
      if (await this.user(email)) return sharedJson({ error: "An account with that email already exists." }, 409);
      const target = coordinator(this.env, "account:" + email);
      const activated = await target.fetch("https://daily.internal/activate", { method: "POST", body: "{}" });
      if (!activated.ok) return sharedJson({ error: "Account creation could not finish. Please retry." }, 503);
      const record = await authPasswordRecord(email, password, { createdAt: Date.now(), sessionVersion: authResetToken() });
      await this.saveUser(record); return sharedJson(await this.newSession(record));
    }
    if (op === "login") {
      const retryAfter = await this.limit("login-global", 200, 900000) || await this.limit("login-ip:" + await authDigest(body.ip || "unknown"), 20, 900000) || await this.limit("login-email:" + await authDigest(email), 20, 900000);
      if (retryAfter) return sharedJson({ error: "Too many sign-in attempts. Please try later.", code: "rate_limited", retryAfter }, 429);
      const record = authValidEmail(email) ? await this.user(email) : null;
      if (!authValidPassword(password) || !record || await authHash(email, password, record.salt, record.hashVersion) !== record.hash) return sharedJson({ error: "Email or password is incorrect." }, 401);
      return sharedJson(await this.newSession(record));
    }
    if (op === "password") {
      const account = await this.session(body.token);
      if (!account) return sharedJson({ error: "Not signed in" }, 401);
      const record = await this.user(account.email);
      if (!record) return sharedJson({ error: "Not signed in" }, 401);
      if (!authValidPassword(password)) return sharedJson({ error: "Password must be 8–256 characters." }, 400);
      await this.saveUser(await authPasswordRecord(account.email, password, record));
      return sharedJson({ ok: true });
    }
    if (op === "delete") {
      const account = await this.session(body.token);
      if (!account) return sharedJson({ error: "Not signed in" }, 401);
      const target = coordinator(this.env, "account:" + account.email);
      const removed = await target.fetch("https://daily.internal/delete", { method: "POST", body: "{}" });
      if (!removed.ok) return sharedJson({ error: "Account deletion could not finish. Please retry." }, 503);
      await this.storage.put("auth-user:" + account.email, { record: null });
      await this.env.SYNC.delete("auth:user:" + account.email);
      await this.env.SYNC.delete("account:" + account.email);
      await this.env.SYNC.delete("auth:session:" + body.token);
      return sharedJson({ ok: true });
    }
    if (op === "forgot-password") {
      if (!recoveryAvailable(this.env)) return sharedJson({ error: "Recovery email is not configured yet. The app owner needs to connect an email sender.", code: "recovery_unavailable" }, 503);
      let appURL; try { appURL = recoveryAppURL(this.env); } catch { return sharedJson({ error: "Recovery email needs its app address configured.", code: "recovery_unavailable" }, 503); }
      if (!authValidEmail(email)) return sharedJson({ error: "Enter a valid email address." }, 400);
      const retryAfter = await this.limit("forgot-global", 200, 3600000) || await this.limit("forgot-ip:" + await authDigest(body.ip || "unknown"), 10, 3600000) || await this.limit("forgot-email:" + await authDigest(email), 3, 3600000);
      if (retryAfter) return sharedJson({ error: "Too many recovery requests. Please wait before trying again.", code: "rate_limited", retryAfter }, 429);
      const record = await this.user(email), token = authResetToken(), digest = await authDigest(token);
      if (record) {
        const key = "auth-reset:" + digest, previous = await this.storage.get("auth-reset-latest:" + email);
        await this.storage.put({ [key]: { email, salt: record.salt, expiresAt: Date.now() + AUTH_RESET_TTL }, ["auth-reset-latest:" + email]: digest });
        if (previous) await this.storage.put("auth-reset:" + previous, null);
        const text = "You requested a password reset for your dashboard.\n\nOpen this link to choose a new password:\n" + appURL + "#/reset-password?token=" + token + "\n\nThis link expires in 20 minutes and can be used once. If you did not request it, you can ignore this email. Your password has not changed.";
        this.waitUntil(sendAuthEmail(this.env, email, "Reset your dashboard password", text).catch(async () => { await this.storage.put(key, null); console.error("Dashboard recovery email delivery failed"); }));
      }
      const ownerOnly = !!this.env.RESEND_API_KEY && !this.env.AUTH_EMAIL?.send && /@resend\.dev(?:>|$)/i.test(String(this.env.AUTH_EMAIL_FROM || ""));
      return sharedJson({ ok: true, message: AUTH_RECOVERY_MESSAGE, retryAfter: 60, ownerOnly });
    }
    if (op === "reset-password") {
      if (!authValidPassword(password)) return sharedJson({ error: "Password must be 8–256 characters." }, 400);
      const retryAfter = await this.limit("reset-global", 200, 900000) || await this.limit("reset-ip:" + await authDigest(body.ip || "unknown"), 20, 900000);
      if (retryAfter) return sharedJson({ error: "Too many attempts. Please wait before trying again.", code: "rate_limited", retryAfter }, 429);
      const invalid = () => sharedJson({ error: "This reset link has expired or has already been used. Request a new link.", code: "invalid_reset_token" }, 400);
      if (!/^[a-f0-9]{64}$/.test(body.token || "")) return invalid();
      const key = "auth-reset:" + await authDigest(body.token), reset = await this.storage.get(key);
      if (!reset || reset.expiresAt <= Date.now()) return invalid();
      const record = await this.user(reset.email);
      if (!record || record.salt !== reset.salt) return invalid();
      const next = await authPasswordRecord(reset.email, password, { ...record, sessionVersion: authResetToken() });
      await this.storage.put({ ["auth-user:" + reset.email]: { record: next }, [key]: null, ["auth-reset-latest:" + reset.email]: null });
      await this.env.SYNC.put("auth:user:" + reset.email, JSON.stringify(next)).catch(() => {});
      if (recoveryAvailable(this.env)) this.waitUntil(sendAuthEmail(this.env, reset.email, "Your dashboard password was changed", "Your dashboard password has been reset. Previous sessions have been signed out. If this was not you, request another reset from " + recoveryAppURL(this.env)).catch(() => { console.error("Dashboard password-change notice delivery failed"); }));
      return sharedJson({ ok: true });
    }
    return sharedJson({ error: "Not found" }, 404);
  }
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

/* Brainflex formats the owner can choose from (dashboard ⚙ on the tile). Each day rotates
   through the chosen kinds; with none chosen, it rotates through all of them. */
var BRAINFLEX_KINDS = {
  fermi: "a Fermi estimate: a rough order-of-magnitude calculation about the real world (e.g. how many cafés are in Sydney?). The solution gives a defensible ballpark first, then the 3-4 assumptions that drive it",
  case: "a consulting case-interview question (market sizing, profitability, pricing or growth) answerable in a few minutes. The solution gives the answer first, then a crisp 2-3 step structure",
  logic: "a logic puzzle (deduction, ordering constraints, knights and knaves) with exactly one valid answer",
  probability: "a probability or expected-value question with a tempting wrong intuition and exactly one correct answer",
  pattern: "a sequence or pattern to complete, with exactly one rule that fits every term",
  mental: "a mental-math challenge that rewards a clever shortcut, with one exact answer",
  lateral: "a lateral-thinking riddle with one satisfying answer that every clue supports"
};
function brainflexKindFor(chosen) {
  const keys = (Array.isArray(chosen) ? chosen : []).filter((k) => BRAINFLEX_KINDS[k]);
  const pool = keys.length ? keys : Object.keys(BRAINFLEX_KINDS);
  const day = Math.floor(Date.now() / 86400000);
  return pool[day % pool.length];
}

/* ---------------- per-key generators (prompts mirror the client) ---------------- */
var sharedGen = {
  word: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `One moderately uncommon but useful English word a curious bilingual reader probably doesn't know, with its French equivalent and a quick synonym quiz. Avoid: ${avoid.join(", ") || "none"}. Shape:{"term_en":"","ipa":"","pos":"","def_en":"","term_fr":"","def_fr":"","quiz":{"options":["","","",""],"answer":0,"alt_prompts":["","",""]}}. Exactly one option is the closest synonym. Every option must be a familiar everyday word, so the quiz tests the new word rather than four obscure words. Distractors remain meaningfully close. Provide 3 short alternative prompts. Defs under 12 words.`, 400).then(extractJSON),

  worth: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown. Select intrinsically useful material whose importance follows naturally from accurate explanation, never from a forced analogy or post-hoc connection. Quiz questions should require a small inference using only material taught in the lesson; do not introduce a new fact or concept.",
    `Write a short daily LESSON in story format. Goal: over many days, make the reader knowledgeable about EVERYTHING — rotate freely across ALL domains (hard sciences, mathematics, medicine, economics, finance, geopolitics, geography, world history, philosophy, psychology, art, architecture, music theory, literature, linguistics, law, technology, engineering, astronomy, ecology, anthropology…). CALIBRATE DIFFICULTY: assume a smart, curious 24-year-old business student who reads the news — skip what such a person already knows (no famous facts everyone learned at school), but stay broadly useful, never niche trivia. The sweet spot: important mechanisms, events, and concepts an educated adult plausibly hasn't mastered. Choose a domain clearly different from these recent lessons: ${(avoid || []).join(" | ") || "none"}. Exactly 2 short paragraphs (~110 words total) separated by \\n\\n, vivid and concrete. Then a one-line memorable insight and a 2-question quiz. Shape:{"title":"","category":"","story":"","insight":"","quiz":[{"prompt":"","options":["","",""],"answer":0,"explain":"","alt_prompts":["",""]},{"prompt":"","options":["","",""],"answer":0,"explain":"","alt_prompts":["",""]}]}. Quiz rules: make each question genuinely difficult through close conceptual distinctions or a small inference using only the lesson. Every prompt is at most 18 words. Every option is a parallel phrase of 2–5 words and at most 28 characters. Wrong options must be plausible and closely related, never absurd or off-topic. Each "explain" one sentence; "answer" is the correct option index. "alt_prompts" are 2 alternative rewordings of the same question, used later for spaced recall.`, 1050).then(extractJSON),

  spanish: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `Crea UN ejercicio diario ESCRITO de español (nada de hablar en voz alta) para un estudiante de nivel intermedio-alto (B1–B2, NO bilingüe): debe construir vocabulario y gramática útiles para conversar. TODO en español, con frases claras y sencillas. Varía el tema cada día; evita estos temas recientes: ${(avoid || []).join(" | ") || "none"}. Contenido: un "punto" de gramática o de uso explicado en 2–3 frases simples con un ejemplo, 3 palabras/expresiones de "vocab" útiles en conversación (con traducción corta al inglés), y un "quiz" de 2 preguntas en español. IMPORTANTE: cada pregunta del quiz debe ser una frase que use NATURALMENTE al menos una de las 3 palabras/expresiones de "vocab" en su propio contexto (no solo preguntar su significado aislado) — por ejemplo completar la frase, elegir el tiempo verbal correcto, o el sinónimo adecuado, siempre dentro de una oración que contenga el vocab enseñado, así el estudiante ve cómo se usa de verdad. Shape:{"tema":"","punto":"","vocab":[{"es":"","en":""},{"es":"","en":""},{"es":"","en":""}],"quiz":[{"prompt":"","options":["","",""],"answer":0,"explain":""},{"prompt":"","options":["","",""],"answer":0,"explain":""}]}. Cada "explain" es una frase sencilla en español.`, 650).then(extractJSON),

  german: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `Crée UN exercice quotidien ÉCRIT d'allemand pour un francophone natif FAUX-DÉBUTANT SOLIDE (A2–B1) : il connaît déjà les bases absolues, ne les lui réexplique pas. Contrairement à l'espagnol, l'allemand se devine mal depuis le français : chaque mot doit donc être enseigné explicitement, jamais supposé transparent. Les explications et les questions sont EN FRANÇAIS ; les exemples et le vocabulaire sont en allemand. Varie le thème chaque jour ; évite ces thèmes récents : ${(avoid || []).join(" | ") || "none"}. Contenu : un "punkt" de grammaire ou d'usage de niveau A2–B1 (cas accusatif/datif en situation, verbes à particule, subordonnées, prépositions mixtes, passé composé…) expliqué en 2–3 phrases précises en français avec UN exemple allemand traduit ; 4 mots/expressions "vocab" utiles et PAS évidents (pas de vocabulaire touristique ultra-basique) — chaque nom commun AVEC son article (der/die/das) — avec traduction française courte "fr" et une prononciation "pron" approximée en graphie française (ex. "ich möchte" → "ich meuchteu") ; un "quiz" de 2 questions de vraie difficulté A2–B1 dont la consigne est en français et les options en allemand, chacune réutilisant naturellement un mot du "vocab" du jour. Shape:{"thema":"","punkt":"","vocab":[{"de":"","fr":"","pron":""},{"de":"","fr":"","pron":""},{"de":"","fr":"","pron":""},{"de":"","fr":"","pron":""}],"quiz":[{"prompt":"","options":["","",""],"answer":0,"explain":""},{"prompt":"","options":["","",""],"answer":0,"explain":""}]}. Chaque "explain" est une phrase simple en français.`, 700).then(extractJSON),

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

  brainflex: async (env, avoid) => {
    let chosen = null;
    try { chosen = parseObject(await env.SYNC.get("shared_config")).brainflexKinds; } catch {}
    const kind = brainflexKindFor(chosen);
    return callClaude(env,
      "You output ONLY valid minified JSON, no markdown. You are a rigorous puzzle setter who helps someone think better, fast: SOLVE the challenge completely yourself before writing it down and check the solution is right; if you cannot verify it, replace it with a simpler one you can. Never pad the prompt with decorative details, extra names, numbers or backstory that play no role in the solution — difficulty comes from the reasoning alone, not from length or noise.",
      `Create ONE self-contained challenge for a smart 24-year-old business student, solvable mentally in 2-5 minutes. Today's format is ${BRAINFLEX_KINDS[kind]}. Vary the topic from these recent ones: ${(avoid || []).join(" | ") || "none"}. The prompt is at most 45 words and contains every fact needed and nothing that isn't. Shape:{"format":"2-4 word name of the format","prompt":"the complete challenge","solution":"the answer in the first few words, then the decisive reasoning in 1-2 short sentences"}.`, 500).then(extractJSON);
  },

  philo: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `Pick ONE deep contested philosophical question beyond introductory level. Assume solid basics and some primary-text familiarity. Vary among mind, epistemology, meta-ethics, freedom, politics, language, aesthetics and science. Avoid: ${(avoid || []).join(" | ") || "none"}. Shape:{"theme":"2-4 word tag","question":"ONE short question, at most 12 words, no preamble or setup — depth comes from the idea, not the length"}.`, 220).then(extractJSON)
};

var sharedHistLabel = {
  word: (v) => v && v.term_en,
  worth: (v) => v && v.title,
  spanish: (v) => v && v.tema,
  german: (v) => v && v.thema,
  music: (v) => v && `${v.title} — ${v.artist} [${v.genre || "?"}]`,
  world: (v) => Array.isArray(v) ? v.map((x) => x.headline) : null,
  brainflex: (v) => v && v.format,
  philo: (v) => v && v.theme
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
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=fr&media=music&entity=song&limit=25`, { signal: AbortSignal.timeout(4000) });
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
  /* geo.music.apple.com redirects to the listener's own storefront, so the link opens
     the exact song in-app for any country instead of dead-ending on a foreign page. */
  const geoUrl = String(best.t.trackViewUrl).replace(/^https:\/\/music\.apple\.com\//, "https://geo.music.apple.com/");
  return { url: geoUrl, trackId: best.t.trackId || "", catalogTitle: best.t.trackName || title, catalogArtist: best.t.artistName || artist, catalogComposer: best.t.composerName || composer, catalogMatched: true };
}

/* Which shared tiles to actually generate, so API tokens aren't spent on tiles
   nobody reads. Precedence:
     1. the `shared_config` KV key {tiles:[...]} — set from the dashboard's
        Settings → "Daily AI content" checklist (per-tile, no Cloudflare edits);
     2. the `SHARED_TILES` Worker variable (comma-separated), as a manual fallback;
     3. DEFAULT_SHARED (word + german) when neither is set — a minimal, token-frugal
        default so a fresh deploy never generates tiles nobody asked for. To
        generate everything, set the in-app checklist or SHARED_TILES explicitly. */
const DEFAULT_SHARED = ["word", "german"];
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
    case "german": return textPresent(value.thema) && textPresent(value.punkt) && Array.isArray(value.vocab) && value.vocab.length > 0 && value.vocab.every(v => v && textPresent(v.de) && textPresent(v.fr)) && Array.isArray(value.quiz) && value.quiz.length > 0 && value.quiz.every(validQuiz);
    case "music": return textPresent(value.title) && textPresent(value.artist) && textPresent(value.why);
    case "world": return Array.isArray(value) && value.length > 0 && value.every(v => v && textPresent(v.headline) && textPresent(v.summary));
    case "brainflex": return textPresent(value.format) && textPresent(value.prompt) && textPresent(value.solution);
    case "philo": return textPresent(value.theme) && textPresent(value.question);
    case "academic": return textPresent(value.concept) && textPresent(value.explain) && Array.isArray(value.quiz) && value.quiz.length > 0 && value.quiz.every(validQuiz);
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
  constructor(state, env) { this.storage = protectedDailyStorage(state.storage); this.env = env; this.queue = Promise.resolve(); this.waitUntil = state.waitUntil ? state.waitUntil.bind(state) : promise => promise.catch(() => {}); }
  fetch(request) {
    const work = this.queue.then(() => this.handle(request));
    this.queue = work.catch(() => {});
    return work;
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    const body = parseObject(await request.json().catch(() => ({})));
    try {
      if (path.startsWith("/auth/")) return await new AuthRecovery(this.storage, this.env, this.waitUntil).handle(path.slice(6), body);
      if (path === "/shared") return await this.shared(body);
      if (path === "/personal") return await this.personal(body);
      if (path === "/account") return await this.account(body);
      if (path === "/delete") { await this.storage.deleteAll(); await this.storage.put("deleted", true); return sharedJson({ ok: true }); }
      if (path === "/activate") { await this.storage.deleteAll(); return sharedJson({ ok: true }); }
      return sharedJson({ error: "Not found" }, 404);
    } catch (error) {
      if (path.startsWith("/auth/")) return sharedJson({ error: "The account service is temporarily unavailable. Please try again.", code: "auth_service_unavailable" }, 503);
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
    if (await this.storage.get("deleted")) return sharedJson({ error: "This account was deleted." }, 403);
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
    if (await this.storage.get("deleted")) return sharedJson({ error: "This account was deleted." }, 403);
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
      return sharedJson({ tiles: c ? (parseObject(c).tiles || null) : null, brainflexKinds: c ? (parseObject(c).brainflexKinds || null) : null, active: await activeSharedKeys(env), all: SHARED_KEYS, safeRetry: !!env.DAILY_COORDINATOR });
    }
    if (url.pathname === "/shared/config" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      // Each field updates only when sent, so saving the tile checklist never wipes the
      // Brainflex formats and vice versa.
      const current = parseObject(await env.SYNC.get("shared_config"));
      const next = { ...current };
      if ("tiles" in body || !("brainflexKinds" in body)) {
        next.tiles = Array.isArray(body.tiles)
          ? body.tiles.map((s) => String(s).trim().toLowerCase()).filter((k) => SHARED_KEYS.includes(k))
          : null;
      }
      if ("brainflexKinds" in body) {
        next.brainflexKinds = Array.isArray(body.brainflexKinds) ? body.brainflexKinds.filter((k) => BRAINFLEX_KINDS[k]) : null;
      }
      await env.SYNC.put("shared_config", JSON.stringify(next));
      return sharedJson({ ok: true, tiles: next.tiles ?? null, brainflexKinds: next.brainflexKinds ?? null });
    }

    // ---- account authentication and account-scoped data ----
    if (["/auth/signup", "/auth/login", "/auth/forgot-password", "/auth/reset-password"].includes(url.pathname) && request.method === "POST") {
      const body = await authBody(request);
      if (!body) return sharedJson({ error: "Invalid request." }, 400);
      return authService(env, url.pathname.slice(6), { ...body, ip: request.headers.get("CF-Connecting-IP") || "unknown" });
    }
    if (url.pathname === "/auth/me" && request.method === "GET") {
      const account = await authAccount(env, request); if (account?.unavailable) return account.response; return account ? sharedJson(account) : sharedJson({ error: "Not signed in" }, 401);
    }
    if (["/auth/password", "/auth/delete"].includes(url.pathname) && request.method === "POST") {
      const body = url.pathname === "/auth/delete" ? {} : await authBody(request);
      if (!body) return sharedJson({ error: "Invalid request." }, 400);
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      return authService(env, url.pathname.slice(6), { password: body.password, token });
    }
    if (url.pathname === "/daily/personal" && request.method === "POST") {
      const account = await authAccount(env, request); if (account?.unavailable) return account.response; if (!account) return sharedJson({ error: "Not signed in" }, 401);
      const body = await request.json().catch(() => ({}));
      const stub = coordinator(env, "account:" + account.email);
      if (!stub) return sharedJson({ date: body.date, content: {}, status: { academic: { state: "server_unconfigured", message: "Academic needs the daily-content server update. Your loaded tiles are safe." } } }, 503);
      return stub.fetch("https://daily.internal/personal", { method: "POST", body: JSON.stringify({ date: body.date, key: body.key, apiKey: body.apiKey, course: body.course, avoid: body.avoid, email: account.email }) });
    }
    if (url.pathname === "/account/data") {
      const account = await authAccount(env, request); if (account?.unavailable) return account.response; if (!account) return sharedJson({ error: "Not signed in" }, 401);
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
