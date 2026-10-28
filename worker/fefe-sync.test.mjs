import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Import the deployable module directly, without a build step or cloud account.
const source = await readFile(new URL("./fefe-sync.js", import.meta.url), "utf8");
const { default: worker, DailyCoordinator } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const date = new Date().toISOString().slice(0, 10);
const word = { term_en: "lucid", def_en: "clear", term_fr: "lucide", quiz: { options: ["clear", "dark"], answer: 0 } };
const philo = { theme: "Free will", question: "Can responsibility survive determinism?" };
const academic = { concept: "Opportunity cost", explain: "The value of the next best alternative.", bigPicture: "Choices allocate scarce resources.", quiz: [1, 2].map(i => ({ prompt: "Which option follows? " + i, options: ["A", "B"], answer: 0, explain: "A follows." })) };

class Storage {
  values = new Map();
  fault = null;
  async get(key) { this.fault?.("get", key); return structuredClone(this.values.get(key)); }
  async put(key, value) {
    this.fault?.("put", key, value);
    if (typeof key === "object") for (const [name, data] of Object.entries(key)) this.values.set(name, structuredClone(data));
    else this.values.set(key, structuredClone(value));
  }
  async deleteAll() { this.fault?.("deleteAll"); this.values.clear(); }
}
class KV {
  values = new Map();
  async get(key, format) { const value = this.values.get(key) ?? null; return format === "json" && value ? JSON.parse(value) : value; }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}
function environment(tiles = ["word", "philo"]) {
  const env = { SYNC: new KV(), ANTHROPIC_API_KEY: "server-key" };
  env.SYNC.values.set("shared_config", JSON.stringify({ tiles }));
  env.SYNC.values.set("auth:session:test-token", "reader@example.test");
  env.SYNC.values.set("auth:user:reader@example.test", JSON.stringify({ email: "reader@example.test", salt: "legacy", hash: "unused-in-these-tests" }));
  const storage = new Map(), instances = new Map();
  env.DAILY_COORDINATOR = {
    idFromName: name => name,
    get(name) {
      if (!storage.has(name)) storage.set(name, new Storage());
      if (!instances.has(name)) instances.set(name, new DailyCoordinator({ storage: storage.get(name) }, env));
      return { fetch: (url, init) => instances.get(name).fetch(new Request(url, init)) };
    }
  };
  return { env, storage, restart: () => instances.clear() };
}
function provider(handler = () => null) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body), prompt = body.messages[0].content;
    const key = prompt.startsWith("One moderately") ? "word" : prompt.startsWith("Pick ONE deep") ? "philo" : "academic";
    calls.push(key);
    await new Promise(resolve => setTimeout(resolve, 5));
    const custom = handler(key, calls.filter(item => item === key).length);
    if (custom instanceof Response) return custom;
    return Response.json({ content: [{ type: "text", text: JSON.stringify(custom ?? { word, philo, academic }[key]) }] });
  };
  return calls;
}
async function request(env, path = "/shared", body, authenticated = false) {
  const headers = authenticated ? { Authorization: "Bearer test-token", "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  const response = await worker.fetch(new Request("https://dashboard.test" + path + (path.includes("?") ? "&" : "?") + "date=" + date, { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  return { code: response.status, data: await response.json(), headers: response.headers };
}

test("concurrent loads, reload, retry and former regenerate all reuse one committed result", async () => {
  const { env, restart } = environment(), calls = provider();
  const responses = await Promise.all(Array.from({ length: 6 }, () => request(env)));
  assert.equal(calls.length, 2);
  responses.forEach(({ data }) => { assert.deepEqual(data.content.word, word); assert.equal(data.status.philo.state, "ready"); });
  restart();
  await request(env, "/shared/retry", { keys: ["word", "philo"] });
  await request(env, "/shared/regenerate", {});
  assert.equal(calls.length, 2);
  const history = JSON.parse(await env.SYNC.get("shared_history"));
  assert.deepEqual(history.word, ["lucid"]);
  assert.deepEqual(history.philo, ["Free will"]);
});

test("independent tiles start together and a fast success commits while another tile is still loading", async () => {
  const { env, storage } = environment();
  env.DAILY_COORDINATOR.get("shared-daily-v1");
  const durable = storage.get("shared-daily-v1"), started = new Set();
  let releaseWord, releasePhilo, wordCommitted;
  const bothStarted = new Promise(resolve => { releaseWord = resolve; });
  const slowTile = new Promise(resolve => { releasePhilo = resolve; });
  const committed = new Promise(resolve => { wordCommitted = resolve; });
  durable.fault = (method, key) => {
    if (method === "put" && typeof key === "object" && key["day:" + date]?.content.word) wordCommitted();
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const prompt = JSON.parse(init.body).messages[0].content;
    const key = prompt.startsWith("One moderately") ? "word" : "philo";
    started.add(key);
    if (started.size === 2) releaseWord();
    await bothStarted;
    if (key === "philo") await slowTile;
    return Response.json({ content: [{ type: "text", text: JSON.stringify({ word, philo }[key]) }] });
  };
  const loading = request(env);
  let deadline;
  try {
    await Promise.race([committed, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("A slow tile blocked the fast tile")), 1000); })]);
    assert.deepEqual([...started], ["word", "philo"]);
    const saved = durable.values.get("day:" + date);
    assert.deepEqual(saved.content.word, word);
    assert.equal(saved.content.philo, undefined);
    assert.equal(saved.status.philo.state, "processing");
  } finally { clearTimeout(deadline); releaseWord(); releasePhilo(); }
  const result = await loading;
  assert.deepEqual(result.data.content, { word, philo });
  assert.deepEqual(JSON.parse(await env.SYNC.get("shared_history")), { word: ["lucid"], philo: ["Free will"] });
  await request(env, "/shared/retry", { keys: ["word", "philo"] });
  assert.equal(started.size, 2);
});

test("a partial failure is visible and retry fills only the missing tile", async () => {
  const { env } = environment(), calls = provider((key, n) => key === "philo" && n === 1 ? { theme: "Incomplete" } : null);
  const first = await request(env);
  assert.equal(first.data.status.philo.state, "invalid_content");
  assert.equal(first.data.content.philo, undefined);
  const retried = await request(env, "/shared/retry", { keys: ["word", "philo"] });
  assert.deepEqual(retried.data.content.word, word);
  assert.deepEqual(retried.data.content.philo, philo);
  assert.deepEqual(calls, ["word", "philo", "philo"]);
  assert.deepEqual(JSON.parse(await env.SYNC.get("shared_history")).word, ["lucid"]);
});

test("a failed compatibility mirror cannot discard committed content or cause regeneration", async () => {
  const { env, restart } = environment(["word"]), calls = provider();
  env.SYNC.put = async () => { throw new Error("KV temporarily unavailable"); };
  const first = await request(env);
  assert.equal(first.data.status.word.state, "ready");
  restart();
  const second = await request(env, "/shared/retry", { keys: ["word"] });
  assert.deepEqual(second.data.content.word, first.data.content.word);
  assert.equal(calls.length, 1);
});

test("disabled tiles and missing server keys never spend provider calls or invent content", async () => {
  const { env } = environment([]), calls = provider();
  let result = await request(env);
  assert.deepEqual(result.data.content, {});
  assert.equal(result.data.status.word.state, "disabled");
  await env.SYNC.put("shared_config", JSON.stringify({ tiles: ["word"] }));
  delete env.ANTHROPIC_API_KEY;
  result = await request(env);
  assert.equal(result.data.status.word.state, "missing_key");
  assert.equal(calls.length, 0);
  env.ANTHROPIC_API_KEY = "fixed";
  result = await request(env, "/shared/retry", { keys: ["word"] });
  assert.equal(result.data.status.word.state, "ready");
  assert.equal(calls.length, 1);
});

test("KV-only deployment keeps cached tiles but fails closed on unsafe generation", async () => {
  const { env } = environment(), calls = provider();
  delete env.DAILY_COORDINATOR;
  await env.SYNC.put("shared:" + date, JSON.stringify({ word, philo: { theme: "partial" } }));
  const result = await request(env);
  assert.deepEqual(result.data.content, { word });
  assert.equal(result.data.status.word.state, "ready");
  assert.equal(result.data.status.philo.state, "server_unconfigured");
  assert.equal(calls.length, 0);
});

test("invalid keys are distinguished from retryable failures", async () => {
  const { env } = environment(["word"]), calls = provider(() => new Response("Unauthorized", { status: 401 }));
  const result = await request(env);
  assert.equal(result.data.status.word.state, "invalid_key");
  assert.deepEqual(result.data.content, {});
  assert.equal(calls.length, 1);
});

test("rate limits and upstream outages explain why a missing tile cannot load", async () => {
  for (const [httpStatus, state] of [[429, "rate_limit"], [500, "service_error"], [503, "service_error"]]) {
    const { env } = environment(["word"]), calls = provider(() => new Response("Provider unavailable", { status: httpStatus }));
    const result = await request(env, "/shared/retry", { keys: ["word"] });
    assert.equal(result.data.date, date);
    assert.deepEqual(result.data.content, {});
    assert.equal(result.data.status.word.state, state);
    assert.ok(result.data.status.word.message.length > 20);
    assert.equal(calls.length, 1);
  }
});

test("unavailable news sources report a feed problem without generating invented news", async () => {
  const { env } = environment(["world"]), calls = [];
  globalThis.fetch = async url => { calls.push(url); return new Response("Feed unavailable", { status: 503 }); };
  const result = await request(env, "/shared/retry", { keys: ["world"] });
  assert.deepEqual(result.data.content, {});
  assert.equal(result.data.status.world.state, "feed_unavailable");
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => url !== "https://api.anthropic.com/v1/messages"));
});

test("a failed durable reservation returns dated JSON with CORS before spending a provider call", async () => {
  const { env, storage } = environment(["word"]), calls = provider();
  env.DAILY_COORDINATOR.get("shared-daily-v1");
  const durable = storage.get("shared-daily-v1");
  durable.fault = method => { if (method === "put") throw new Error("PRIVATE_STORAGE_DETAIL"); };
  const result = await request(env, "/shared/retry", { keys: ["word"] });
  assert.equal(result.code, 503);
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(result.headers.get("Content-Type"), "application/json");
  assert.equal(result.data.date, date);
  assert.deepEqual(result.data.content, {});
  assert.equal(result.data.status.word.state, "server_storage_error");
  assert.ok(!JSON.stringify(result.data).includes("PRIVATE_STORAGE_DETAIL"));
  assert.equal(calls.length, 0);
  durable.fault = null;
  assert.equal((await request(env, "/shared/retry", { keys: ["word"] })).data.status.word.state, "ready");
  assert.equal(calls.length, 1);
});

test("a persistent commit failure cannot expose generated content or discard another saved tile", async () => {
  const { env, storage } = environment(["word", "philo"]), calls = provider();
  env.DAILY_COORDINATOR.get("shared-daily-v1");
  const durable = storage.get("shared-daily-v1");
  await durable.put("day:" + date, { content: { word }, status: { word: { state: "ready" } } });
  durable.fault = method => { if (method === "put" && calls.length) throw new Error("Permanent commit failure"); };
  const failed = await request(env, "/shared/retry", { keys: ["philo"] });
  assert.equal(failed.code, 503);
  assert.equal(failed.data.date, date);
  assert.deepEqual(failed.data.content, {});
  assert.equal(failed.data.status.philo.state, "server_storage_error");
  assert.deepEqual(calls, ["philo"]);
  const saved = durable.values.get("day:" + date);
  assert.deepEqual(saved.content.word, word);
  assert.equal(saved.content.philo, undefined);
  durable.fault = null;
  const retried = await request(env, "/shared/retry", { keys: ["word", "philo"] });
  assert.deepEqual(retried.data.content, { word, philo });
  assert.deepEqual(calls, ["philo", "philo"]);
  await request(env, "/shared/retry", { keys: ["word", "philo"] });
  assert.equal(calls.length, 2);
});

test("one failed parallel commit cannot leak its candidate through a successful neighbour", async () => {
  const { env, storage } = environment(), calls = provider();
  env.DAILY_COORDINATOR.get("shared-daily-v1");
  const durable = storage.get("shared-daily-v1");
  durable.fault = (method, key) => {
    if (method === "put" && typeof key === "object" && key["day:" + date]?.content.word) throw new Error("Word commit failed");
  };
  const first = await request(env);
  assert.equal(first.code, 503);
  assert.deepEqual(first.data.content, {});
  const saved = durable.values.get("day:" + date);
  assert.equal(saved.content.word, undefined);
  assert.deepEqual(saved.content.philo, philo);
  assert.deepEqual(durable.values.get("history"), { philo: ["Free will"] });
  durable.fault = null;
  const retried = await request(env, "/shared/retry", { keys: ["word", "philo"] });
  assert.deepEqual(retried.data.content, { philo, word });
  assert.deepEqual(calls, ["word", "philo", "word"]);
});

test("a durable read outage also returns an actionable tile status without spending tokens", async () => {
  const { env, storage } = environment(["word"]), calls = provider();
  env.DAILY_COORDINATOR.get("shared-daily-v1");
  storage.get("shared-daily-v1").fault = method => { if (method === "get") throw new Error("Read unavailable"); };
  const result = await request(env, "/shared/retry", { keys: ["word"] });
  assert.equal(result.code, 503);
  assert.equal(result.data.date, date);
  assert.deepEqual(result.data.content, {});
  assert.equal(result.data.status.word.state, "server_storage_error");
  assert.equal(calls.length, 0);
});

test("an uncommitted personal lesson is withheld when its durable save fails", async () => {
  const { env, storage } = environment(), calls = provider();
  env.DAILY_COORDINATOR.get("account:reader@example.test");
  const durable = storage.get("account:reader@example.test");
  durable.fault = method => { if (method === "put" && calls.length) throw new Error("Permanent personal commit failure"); };
  const body = { date, key: "academic", apiKey: "PERSONAL_SECRET", course: { id: "course", name: "Course", content: "PRIVATE_COURSE_NOTES" } };
  const result = await request(env, "/daily/personal", body, true);
  assert.equal(result.code, 503);
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(result.data.date, date);
  assert.deepEqual(result.data.content, {});
  assert.equal(result.data.status.academic.state, "server_storage_error");
  assert.equal(durable.values.get("personal:" + date).content.academic, undefined);
  const persisted = JSON.stringify([...durable.values]);
  assert.ok(!persisted.includes(body.apiKey));
  assert.ok(!persisted.includes(body.course.content));
  durable.fault = null;
  assert.equal((await request(env, "/daily/personal", body, true)).data.status.academic.state, "ready");
  assert.equal((await request(env, "/daily/personal", { date, key: "academic" }, true)).data.status.academic.state, "ready");
  assert.equal(calls.length, 2);
});

test("failed account commits preserve the previous snapshot and return a typed error", async () => {
  const { env, storage } = environment();
  const original = { updatedAt: 1, data: { ["fefe_daily:" + date]: JSON.stringify({ word }), fefe_notes: JSON.stringify({ [date]: "Saved note" }) } };
  await request(env, "/account/data", original, true);
  const durable = storage.get("account:reader@example.test");
  durable.fault = method => { if (method === "put") throw new Error("Account storage unavailable"); };
  const result = await request(env, "/account/data", { updatedAt: 2, data: { fefe_notes: JSON.stringify({ [date]: "Unsaved change" }) } }, true);
  assert.equal(result.code, 503);
  assert.equal(result.data.code, "server_storage_error");
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(durable.values.get("account"), original);
  assert.deepEqual((await request(env, "/account/data", undefined, true)).data, original);
});

test("an interrupted uncommitted reservation can retry and then freezes its first success", async () => {
  const { env, storage } = environment(["word"]), calls = provider();
  env.DAILY_COORDINATOR.get("shared-daily-v1");
  await storage.get("shared-daily-v1").put("day:" + date, { content: {}, status: { word: { state: "processing", startedAt: Date.now() } } });
  const result = await request(env, "/shared/retry", { keys: ["word"] });
  assert.equal(result.data.status.word.state, "ready");
  assert.deepEqual(result.data.content.word, word);
  await request(env);
  assert.equal(calls.length, 1);
});

test("invalid and historical dates cannot trigger generation", async () => {
  const { env } = environment(), calls = provider();
  let response = await worker.fetch(new Request("https://dashboard.test/shared?date=2026-02-31"), env);
  assert.equal(response.status, 400);
  response = await worker.fetch(new Request("https://dashboard.test/shared?date=2020-01-01"), env);
  assert.deepEqual((await response.json()).content, {});
  assert.equal(calls.length, 0);
});

test("personal generation freezes across simultaneous devices and never persists the personal key or notes", async () => {
  const { env, storage, restart } = environment(), calls = provider();
  const body = { date, key: "academic", apiKey: "PRIVATE_PERSONAL_KEY", course: { id: "economics", name: "Economics", content: "PRIVATE_UNPERSISTED_COURSE_NOTES" }, avoid: [] };
  const results = await Promise.all([request(env, "/daily/personal", body, true), request(env, "/daily/personal", { ...body, course: { id: "other", name: "Other", content: "Different notes" } }, true)]);
  assert.equal(calls.length, 1);
  assert.deepEqual(results[0].data.content, results[1].data.content);
  restart();
  const cached = await request(env, "/daily/personal", { date, key: "academic" }, true);
  assert.equal(cached.data.status.academic.state, "ready");
  assert.equal(calls.length, 1);
  const persisted = JSON.stringify([...storage.get("account:reader@example.test").values]);
  assert.ok(!persisted.includes(body.apiKey));
  assert.ok(!persisted.includes(body.course.content));
});

test("personal prerequisites are explicit and unauthenticated callers cannot generate", async () => {
  const { env } = environment(), calls = provider();
  assert.equal((await request(env, "/daily/personal", { date, key: "academic" })).code, 401);
  assert.equal((await request(env, "/daily/personal", { date, key: "academic" }, true)).data.status.academic.state, "missing_key");
  assert.equal((await request(env, "/daily/personal", { date, key: "academic", apiKey: "key" }, true)).data.status.academic.state, "missing_course");
  assert.equal(calls.length, 0);
});

test("missing auth coordinator fails closed before private daily generation", async () => {
  const { env } = environment(), calls = provider();
  delete env.DAILY_COORDINATOR;
  const result = await request(env, "/daily/personal", { date, key: "academic" }, true);
  assert.equal(result.code, 503);
  assert.equal(result.data.code, "recovery_unavailable");
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(calls.length, 0);
});

test("account sync merges daily successes, strips credentials and rejects stale snapshots", async () => {
  const { env } = environment();
  const name = "fefe_daily:" + date;
  const first = { updatedAt: 1, data: { [name]: JSON.stringify({ word }), fefe_accountToken: "secret", fefe_apiKey: "secret" } };
  assert.equal((await request(env, "/account/data", first, true)).data.stored, true);
  const next = { updatedAt: 2, data: { [name]: JSON.stringify({ word: { ...word, term_en: "replacement" }, philo }), fefe_noteText: JSON.stringify("edited") } };
  await Promise.all([request(env, "/account/data", next, true), request(env, "/account/data", { updatedAt: 3, data: { [name]: JSON.stringify({ word: null }) } }, true)]);
  let snapshot = (await request(env, "/account/data", undefined, true)).data;
  assert.deepEqual(JSON.parse(snapshot.data[name]), { word, philo });
  assert.equal(snapshot.data.fefe_accountToken, undefined);
  assert.equal(snapshot.data.fefe_apiKey, undefined);
  const stale = await request(env, "/account/data", first, true);
  assert.equal(stale.data.stored, false);
  assert.equal(stale.data.updatedAt, 3);
  snapshot = (await request(env, "/account/data", undefined, true)).data;
  assert.deepEqual(JSON.parse(snapshot.data[name]), { word, philo });
});

test("a lesson already synced by an older client is not generated again", async () => {
  const { env } = environment(), calls = provider();
  const saved = { ...academic, courseId: "old-course", courseName: "Saved course" };
  await env.SYNC.put("account:reader@example.test", JSON.stringify({ updatedAt: 1, data: { ["fefe_daily:" + date]: JSON.stringify({ academic: saved }) } }));
  const result = await request(env, "/daily/personal", { date, key: "academic" }, true);
  assert.deepEqual(result.data.content.academic, saved);
  assert.equal(calls.length, 0);
});

test("backend and frontend accept exactly the same daily shapes, including malformed rows", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const frontendSource = html.split("/* DAILY_CONTENT_CONTRACT_START */")[1].split("/* DAILY_CONTENT_CONTRACT_END */")[0];
  const clientValid = runInNewContext(frontendSource + ";validDailyTile");
  const backendSource = source.slice(source.indexOf("const textPresent ="), source.indexOf("function parseObject("));
  const serverValid = runInNewContext(backendSource + ";validDailyContent");
  const quiz = { prompt: "Question?", options: ["A", "B"], answer: 0, explain: "Reason" };
  const samples = [null, {}, [], [null], [quiz], word, { ...word, term_fr: undefined }, philo, academic,
    { title: "Lesson", story: "Story", quiz: [quiz] }, { title: "Broken", story: "Story", quiz: [null] },
    { title: "Missing visible prompt", story: "Story", quiz: [{ ...quiz, prompt: undefined, question: "Unsupported alias?" }] },
    { tema: "Tema", punto: "Punto", vocab: [null], quiz: [quiz] }, { tema: "Tema", punto: "Punto", vocab: [{ es: "Uno", en: "One" }], quiz: [quiz] },
    [{ headline: "Headline", summary: "Summary" }], { place: "Sydney", temp: 20, code: 0 },
    { place: "Sydney", temp: 20, code: 0, hi: 23, lo: 15, tomorrow: { hi: 24, lo: 16, code: 1 } },
    { title: "Music", artist: "Artist", why: "Listen" }, { format: "Logic", prompt: "Challenge", solution: "Answer" }];
  for (const key of ["word", "worth", "spanish", "music", "world", "weather", "brainflex", "philo", "academic"]) {
    for (const sample of samples) assert.equal(Boolean(serverValid(key, sample)), Boolean(clientValid(key, sample)), key + ": " + JSON.stringify(sample));
  }
});

test("public dashboard assets use their real MIME type and never fall back to HTML", async () => {
  const { env } = environment();
  env.SYNC.values.set("__html__", "<!doctype html><title>Dashboard</title>");
  env.SYNC.values.set("asset:/dashboard.webmanifest", JSON.stringify({ name: "Dashboard" }));
  env.SYNC.values.set("asset:/assets/icons/favicon-32.png", new Uint8Array([137,80,78,71]).buffer);
  const manifest = await worker.fetch(new Request("https://dashboard.test/dashboard.webmanifest"), env);
  assert.equal(manifest.status, 200); assert.match(manifest.headers.get("Content-Type"), /manifest/);
  assert.equal((await manifest.json()).name, "Dashboard");
  const icon = await worker.fetch(new Request("https://dashboard.test/assets/icons/favicon-32.png"), env);
  assert.equal(icon.headers.get("Content-Type"), "image/png");
  assert.deepEqual([...new Uint8Array(await icon.arrayBuffer())], [137,80,78,71]);
  const missing = await worker.fetch(new Request("https://dashboard.test/assets/icons/dashboard-512.png"), env);
  assert.equal(missing.status, 404); assert.doesNotMatch(await missing.text(), /doctype/);
});
test("asset routes cannot expose account records or arbitrary KV keys", async () => {
  const { env } = environment(); env.SYNC.values.set("__html__", "PUBLIC_HTML");
  env.SYNC.values.set("account:reader@example.test", "PRIVATE_SNAPSHOT");
  const response = await worker.fetch(new Request("https://dashboard.test/assets/account:reader@example.test"), env);
  assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), /PRIVATE_SNAPSHOT|PUBLIC_HTML/);
});
