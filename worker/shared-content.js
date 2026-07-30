/*
 * Fefe — shared community daily content Worker
 * ------------------------------------------------------------------
 * Generates the COMMON daily tiles ONCE per day using a server-side
 * Anthropic key, caches the result in KV, and serves the same content
 * to every dashboard. No visitor needs their own API key for these
 * tiles, and the whole community costs ~7 Haiku calls per day total.
 *
 * Shared keys: word, worth (knowledge), spanish, music, world (news),
 *              brainflex, philo (the daily prompt only — chat stays
 *              per-user because each conversation is unique).
 * NOT shared:  weather (free + location-specific), academic (personal),
 *              philosophy chat (per-user key).
 *
 * Endpoints (CORS-open):
 *   GET  /shared            -> { date, content:{...} }   (generates lazily if missing)
 *   GET  /shared?date=YYYY-MM-DD  -> that day's content if cached
 *   POST /shared/regenerate -> force today's regeneration (guard with ?token=)
 *
 * Setup (see worker/README-deploy.md):
 *   - KV namespace bound as  SHARED
 *   - Secret  ANTHROPIC_API_KEY
 *   - (optional) secret  ADMIN_TOKEN  to protect /shared/regenerate
 *   - Cron trigger (e.g. "0 4 * * *") to pre-warm each morning
 */

const SHARED_KEYS = ["word", "worth", "spanish", "music", "world", "brainflex", "philo"];
const MODEL = "claude-haiku-4-5-20251001";
const TZ = "Europe/Paris"; // the day flips at local midnight here
const RSS_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.skynews.com/feeds/rss/world.xml",
  "https://www.france24.com/en/rss",
];

/* ---------- helpers ---------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

function dayKey() {
  // en-CA gives YYYY-MM-DD; pin to TZ so every user shares one "today"
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

function extractJSON(text) {
  if (!text) return null;
  let t = text.replace(/```json|```/g, "").trim();
  const starts = [t.indexOf("{"), t.indexOf("[")].filter(i => i >= 0);
  const a = starts.length ? Math.min(...starts) : -1;
  const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

async function callClaude(env, system, user, max = 600) {
  const body = { model: MODEL, max_tokens: max, system, messages: [{ role: "user", content: user }] };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

/* ---------- per-key generators (prompts mirror the client) ---------- */
const gen = {
  word: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `One moderately uncommon but useful English word a curious bilingual reader probably doesn't know, with its French equivalent and a quick synonym quiz. Avoid: ${avoid.join(", ") || "none"}. Shape:{"term_en":"","ipa":"","pos":"","def_en":"","term_fr":"","def_fr":"","quiz":{"options":["","","",""],"answer":0,"alt_prompts":["","",""]}}. Exactly one option is the closest synonym. Every option must be a familiar everyday word, so the quiz tests the new word rather than four obscure words. Distractors remain meaningfully close. Provide 3 short alternative prompts. Defs under 12 words.`, 400).then(extractJSON),

  worth: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown. Select intrinsically useful material whose importance follows naturally from accurate explanation, never from a forced analogy or post-hoc connection. Quiz questions should require a small inference using only material taught in the lesson; do not introduce a new fact or concept.",
    `Write a short daily LESSON in story format. Goal: over many days, make the reader knowledgeable about EVERYTHING — rotate freely across ALL domains (hard sciences, mathematics, medicine, economics, finance, geopolitics, geography, world history, philosophy, psychology, art, architecture, music theory, literature, linguistics, law, technology, engineering, astronomy, ecology, anthropology…). CALIBRATE DIFFICULTY: assume a smart, curious 24-year-old business student who reads the news — skip what such a person already knows (no famous facts everyone learned at school), but stay broadly useful, never niche trivia. The sweet spot: important mechanisms, events, and concepts an educated adult plausibly hasn't mastered. Choose a domain clearly different from these recent lessons: ${(avoid || []).join(" | ") || "none"}. Exactly 2 short paragraphs (~110 words total) separated by \\n\\n, vivid and concrete. Then a one-line memorable insight and a 2-question quiz. Shape:{"title":"","category":"","story":"","insight":"","quiz":[{"prompt":"","options":["","",""],"answer":0,"explain":"","alt_prompts":["",""]},{"prompt":"","options":["","",""],"answer":0,"explain":"","alt_prompts":["",""]}]}. Quiz rules: make each question genuinely difficult through close conceptual distinctions or a small inference using only the lesson. Every prompt is at most 18 words. Every option is a parallel phrase of 2–5 words and at most 28 characters. Wrong options must be plausible and closely related, never absurd or off-topic. Each "explain" one sentence; "answer" is the correct option index. "alt_prompts" are 2 alternative rewordings of the same question, used later for spaced recall.`, 1050).then(extractJSON),

  spanish: (env, avoid) => callClaude(env, "You output ONLY valid minified JSON, no markdown.",
    `Crea UN ejercicio diario ESCRITO de español (nada de hablar en voz alta) para un estudiante de nivel intermedio-alto (B1–B2, NO bilingüe): debe construir vocabulario y gramática útiles para conversar. TODO en español, con frases claras y sencillas. Varía el tema cada día; evita estos temas recientes: ${(avoid || []).join(" | ") || "none"}. Contenido: un "punto" de gramática o de uso explicado en 2–3 frases simples con un ejemplo, 3 palabras/expresiones de "vocab" útiles en conversación (con traducción corta al inglés), y un "quiz" de 2 preguntas en español. IMPORTANTE: cada pregunta del quiz debe ser una frase que use NATURALMENTE al menos una de las 3 palabras/expresiones de "vocab" en su propio contexto (no solo preguntar su significado aislado) — por ejemplo completar la frase, elegir el tiempo verbal correcto, o el sinónimo adecuado, siempre dentro de una oración que contenga el vocab enseñado, así el estudiante ve cómo se usa de verdad. Shape:{"tema":"","punto":"","vocab":[{"es":"","en":""},{"es":"","en":""},{"es":"","en":""}],"quiz":[{"prompt":"","options":["","",""],"answer":0,"explain":""},{"prompt":"","options":["","",""],"answer":0,"explain":""}]}. Cada "explain" es una frase sencilla en español.`, 650).then(extractJSON),

  music: async (env, avoid) => {
    const base = await callClaude(env, "You output ONLY valid minified JSON, no markdown.",
      `Recommend ONE specific, real recording that is critically or technically excellent yet UNDERRATED — something most people don't know but that a musicologist or serious critic would admire (craft, innovation, influence, musicianship). Deliberately vary widely across genres, eras and cultures every time (e.g. modal jazz, West African highlife, ambient, post-punk, bossa nova, baroque, experimental electronic, Appalachian folk, dub). It MUST be findable as a track in Apple Music. Give the exact released track title. "artist" is the complete recording credit (all named performers, ensemble and/or conductor as appropriate), not automatically the composer and not artificially reduced to one person. For classical music, include the work's composer separately in "composer"; otherwise "composer" may be empty. Avoid anything mainstream or famous, and do NOT repeat: ${avoid.join(" | ") || "none"}. Shape:{"title":"","artist":"","composer":"","year":"","genre":"","why":""}. "genre" is the specific style; "why" (max 18 words) says what makes it special and why it's overlooked.`, 420).then(extractJSON);
    if (!base || !base.title) return base;
    const match = await resolveMusic(base).catch(() => null);
    return match ? { ...base, ...match } : base;
  },

  world: async (env, avoid) => {
    const items = await fetchRss();
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
};

/* history label used to build each key's "avoid" list */
const histLabel = {
  word: v => v && v.term_en,
  worth: v => v && v.title,
  spanish: v => v && v.tema,
  music: v => v && `${v.title} — ${v.artist}`,
  world: v => Array.isArray(v) ? v.map(x => x.headline) : null,
  brainflex: v => v && v.format,
  philo: v => v && v.theme,
};

/* ---------- news (server-side RSS, no CORS) ---------- */
async function fetchRss() {
  const per = await Promise.allSettled(RSS_FEEDS.map(async url => {
    const r = await fetch(url, { headers: { "user-agent": "fefe-dashboard/1.0" } });
    if (!r.ok) throw new Error("feed " + r.status);
    const text = await r.text();
    const items = [];
    const re = /<item[\s\S]*?<\/item>/g;
    let m;
    while ((m = re.exec(text)) && items.length < 10) {
      const block = m[0];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1]
        .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim();
      const desc = (block.match(/<description>([\s\S]*?)<\/description>/) || [, ""])[1]
        .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim();
      if (title) items.push({ title, desc });
    }
    return items;
  }));
  const all = [], seen = new Set();
  per.forEach(r => { if (r.status === "fulfilled") r.value.forEach(it => {
    const k = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 6).join(" ");
    if (k && !seen.has(k)) { seen.add(k); all.push(it); }
  }); });
  return all.length ? all : null;
}

/* ---------- iTunes match for the music link (free, no key) ---------- */
const mNorm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const M_NOISE = new Set(["a", "an", "the", "and", "feat", "featuring", "with", "version", "edit", "remaster", "remastered", "mono", "stereo"]);
const mTokens = s => new Set(mNorm(s).split(/\s+/).filter(w => w && !M_NOISE.has(w)));
function mOverlap(a, b) { const aa = mTokens(a), bb = mTokens(b); if (!aa.size || !bb.size) return 0; let h = 0; aa.forEach(w => { if (bb.has(w)) h++; }); return h / Math.max(aa.size, bb.size); }
async function resolveMusic(m) {
  const title = String(m.title || "").trim(), artist = String(m.artist || "").trim(), composer = String(m.composer || "").trim();
  if (!title) return null;
  const queries = [`${title} ${artist} ${composer}`, `${title} ${artist}`, `${title} ${composer}`].map(q => q.trim()).filter((q, i, a) => q && a.indexOf(q) === i);
  const cand = new Map();
  for (const q of queries) {
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=au&media=music&entity=song&limit=25`);
      if (!r.ok) continue;
      const d = await r.json();
      (d.results || []).forEach(t => { if (t.trackViewUrl) cand.set(String(t.trackId || t.trackViewUrl), t); });
    } catch {}
  }
  const wantCredit = [artist, composer].filter(Boolean).join(" ");
  const scored = [...cand.values()].map(t => {
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

/* ---------- generate + cache the whole day ---------- */
async function generateDay(env, date) {
  const hist = JSON.parse((await env.SHARED.get("history")) || "{}");
  const results = await Promise.all(SHARED_KEYS.map(k => {
    const avoid = (hist[k] || []).slice(-20);
    return gen[k](env, avoid).catch(() => null);
  }));
  const content = {};
  SHARED_KEYS.forEach((k, i) => { if (results[i]) content[k] = results[i]; });

  // roll the "avoid" history forward for variety
  SHARED_KEYS.forEach((k, i) => {
    const v = results[i]; if (!v) return;
    const lab = histLabel[k] ? histLabel[k](v) : null;
    if (!lab) return;
    hist[k] = [...(hist[k] || []), ...(Array.isArray(lab) ? lab : [lab])].slice(-40);
  });

  await env.SHARED.put("shared:" + date, JSON.stringify(content));
  await env.SHARED.put("history", JSON.stringify(hist));
  return content;
}

/* ---------- HTTP + cron ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/shared" && request.method === "GET") {
      const date = url.searchParams.get("date") || dayKey();
      let raw = await env.SHARED.get("shared:" + date);
      if (!raw && date === dayKey()) {
        // lazy generate today with a short best-effort lock to avoid a stampede
        const locked = await env.SHARED.get("lock:" + date);
        if (!locked) {
          await env.SHARED.put("lock:" + date, "1", { expirationTtl: 120 });
          try { const content = await generateDay(env, date); raw = JSON.stringify(content); }
          finally { await env.SHARED.delete("lock:" + date); }
        }
      }
      return json({ date, content: raw ? JSON.parse(raw) : null });
    }

    if (url.pathname === "/shared/regenerate" && request.method === "POST") {
      if (env.ADMIN_TOKEN && url.searchParams.get("token") !== env.ADMIN_TOKEN)
        return json({ error: "unauthorized" }, 401);
      const date = dayKey();
      const content = await generateDay(env, date);
      return json({ date, content });
    }

    return json({ ok: true, service: "fefe-shared", keys: SHARED_KEYS, today: dayKey() });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateDay(env, dayKey()));
  },
};
