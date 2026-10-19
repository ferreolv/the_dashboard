import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = await readFile(new URL('./fefe-sync.js', import.meta.url), 'utf8');
const { default: worker, DailyCoordinator } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const email = 'reader@example.test';
const password = 'original-password';
const nextPassword = 'changed-password';

function setup({ configured = true } = {}) {
  const values = new Map(), durable = new Map(), instances = new Map(), emails = [], pending = [], faults = new Map();
  const legacy = { email, salt: 'old-salt', hash: createHash('sha256').update('old-salt:' + email + ':' + password).digest('hex'), createdAt: 123 };
  values.set('auth:user:' + email, JSON.stringify(legacy));
  values.set('auth:session:legacy-session-token', email);
  values.set('account:' + email, JSON.stringify({ updatedAt: 1, data: { fefe_notes: 'KEEP MY NOTES' } }));
  const env = {
    SYNC: {
      async get(key, type) { const value = values.get(key) ?? null; return type === 'json' && value ? JSON.parse(value) : value; },
      async put(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); },
    },
    AUTH_APP_URL: 'https://dashboard.example.test/',
    ...(configured ? { AUTH_EMAIL_FROM: 'Dashboard <recovery@example.test>', AUTH_EMAIL: { async send(message) { emails.push(message); return { messageId: 'test-message' }; } } } : {}),
  };
  env.DAILY_COORDINATOR = {
    idFromName: value => value,
    get(name) {
      if (!durable.has(name)) durable.set(name, new Map());
      if (!instances.has(name)) {
        const data = durable.get(name);
        const storage = {
          async get(key) { faults.get(name)?.("get", key); return structuredClone(data.get(key)); },
          async put(key, value) { faults.get(name)?.("put", key, value); if (typeof key === 'object') for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v)); else data.set(key, structuredClone(value)); },
          async deleteAll() { data.clear(); },
        };
        instances.set(name, new DailyCoordinator({ storage, waitUntil: promise => pending.push(promise) }, env));
      }
      return { fetch: (url, init) => instances.get(name).fetch(new Request(url, init)) };
    },
  };
  const request = async (path, body, token, headers = {}) => {
    const response = await worker.fetch(new Request('https://dashboard.test' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: response.status, body: await response.json() };
  };
  const flush = async () => { await Promise.all(pending.splice(0)); };
  const tokenFrom = message => message.text.match(/#\/reset-password\?token=([a-f0-9]{64})/)?.[1];
  return { env, values, durable, emails, request, flush, tokenFrom, setFault: (name, fault) => faults.set(name, fault), restart: () => instances.clear() };
}

test('recovery accepts registered and unknown addresses identically without exposing a token', async () => {
  const s = setup();
  const known = await s.request('/auth/forgot-password', { email: '  READER@EXAMPLE.TEST ' });
  const unknown = await s.request('/auth/forgot-password', { email: 'nobody@example.test' });
  await s.flush();
  assert.deepEqual(known, unknown);
  assert.equal(known.status, 200);
  assert.equal(s.emails.length, 1);
  assert.equal(s.emails[0].to, email);
  const token = s.tokenFrom(s.emails[0]);
  assert.equal(token.length, 64);
  assert.ok(s.emails[0].text.includes('https://dashboard.example.test/#/reset-password?token='));
  const stored = JSON.stringify([...s.durable.get('auth-recovery-v1')]);
  assert.ok(!stored.includes(token));
  assert.ok(!JSON.stringify(known).includes(token));
  assert.equal((await s.request('/auth/me', undefined, 'legacy-session-token')).status, 200);
});

test('one-use reset survives restart, revokes all sessions and preserves dashboard data', async () => {
  const s = setup();
  const signedIn = await s.request('/auth/login', { email, password });
  assert.equal(signedIn.status, 200);
  await s.request('/auth/forgot-password', { email }); await s.flush();
  const token = s.tokenFrom(s.emails[0]);
  s.restart();
  const reset = await s.request('/auth/reset-password', { token, password: nextPassword });
  assert.deepEqual(reset, { status: 200, body: { ok: true } });
  assert.equal((await s.request('/auth/reset-password', { token, password: nextPassword })).body.code, 'invalid_reset_token');
  assert.equal((await s.request('/auth/login', { email, password })).status, 401);
  assert.equal((await s.request('/auth/me', undefined, signedIn.body.token)).status, 401);
  assert.equal((await s.request('/auth/me', undefined, 'legacy-session-token')).status, 401);
  const newLogin = await s.request('/auth/login', { email, password: nextPassword });
  assert.equal(newLogin.status, 200);
  assert.equal((await s.request('/auth/me', undefined, newLogin.body.token)).body.email, email);
  assert.ok(s.values.get('account:' + email).includes('KEEP MY NOTES'));
  const record = JSON.parse(s.values.get('auth:user:' + email));
  assert.equal(record.hashVersion, 'pbkdf2-sha256-v1');
  assert.ok(!JSON.stringify(record).includes(nextPassword));
  await s.flush();
  assert.equal(s.emails[1].subject, 'Your dashboard password was changed');
  assert.ok(!s.emails[1].text.includes(nextPassword));
});

test('concurrent use of one reset link changes the password only once', async () => {
  const s = setup(); await s.request('/auth/forgot-password', { email }); await s.flush();
  const token = s.tokenFrom(s.emails[0]);
  const results = await Promise.all([
    s.request('/auth/reset-password', { token, password: nextPassword }),
    s.request('/auth/reset-password', { token, password: 'other-password' }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal((await s.request('/auth/login', { email, password: nextPassword })).status, 200);
});

test('expired links and malformed tokens never change an account', async () => {
  const s = setup(); await s.request('/auth/forgot-password', { email }); await s.flush();
  const token = s.tokenFrom(s.emails[0]), data = s.durable.get('auth-recovery-v1');
  const resetKey = 'auth-reset:' + createHash('sha256').update(token).digest('hex');
  data.set(resetKey, { ...data.get(resetKey), expiresAt: Date.now() - 1 });
  for (const candidate of [token, 'wrong', 'a'.repeat(64)]) assert.equal((await s.request('/auth/reset-password', { token: candidate, password: nextPassword })).body.code, 'invalid_reset_token');
  assert.equal((await s.request('/auth/login', { email, password })).status, 200);
});

test('a newer recovery request invalidates its previous link', async () => {
  const s = setup(); await s.request('/auth/forgot-password', { email }); await s.flush();
  const first = s.tokenFrom(s.emails[0]);
  await s.request('/auth/forgot-password', { email }); await s.flush();
  assert.equal((await s.request('/auth/reset-password', { token: first, password: nextPassword })).status, 400);
  assert.equal((await s.request('/auth/reset-password', { token: s.tokenFrom(s.emails[1]), password: nextPassword })).status, 200);
});

test('authenticated password changes invalidate earlier reset links', async () => {
  const s = setup(); await s.request('/auth/forgot-password', { email }); await s.flush();
  assert.equal((await s.request('/auth/password', { password: nextPassword }, 'legacy-session-token')).status, 200);
  assert.equal((await s.request('/auth/reset-password', { token: s.tokenFrom(s.emails[0]), password })).status, 400);
});

test('missing email setup reports a real setup failure equally for every address', async () => {
  const s = setup({ configured: false });
  const known = await s.request('/auth/forgot-password', { email });
  assert.deepEqual(known, await s.request('/auth/forgot-password', { email: 'nobody@example.test' }));
  assert.equal(known.status, 503);
  assert.equal(known.body.code, 'recovery_unavailable');
});

test('failed delivery cannot leave a usable reset token or expose account existence', async () => {
  const s = setup();
  s.env.AUTH_EMAIL.send = async message => { s.emails.push(message); throw new Error('PRIVATE_PROVIDER_DETAIL'); };
  const known = await s.request('/auth/forgot-password', { email }); await s.flush();
  const unknown = await s.request('/auth/forgot-password', { email: 'nobody@example.test' });
  assert.deepEqual(known, unknown);
  assert.equal((await s.request('/auth/reset-password', { token: s.tokenFrom(s.emails[0]), password: nextPassword })).status, 400);
  assert.ok(!JSON.stringify(known).includes('PRIVATE_PROVIDER_DETAIL'));
});

test('email request limits apply to known and unknown accounts', async () => {
  for (const address of [email, 'nobody@example.test']) {
    const s = setup();
    for (let n = 0; n < 3; n++) assert.equal((await s.request('/auth/forgot-password', { email: address })).status, 200);
    const limited = await s.request('/auth/forgot-password', { email: address });
    assert.equal(limited.status, 429); assert.equal(limited.body.code, 'rate_limited');
  }
});

test('the recovery URL uses configured origin and never the request Host or Origin', async () => {
  const s = setup();
  await s.request('/auth/forgot-password', { email, redirect: 'https://attacker.example/' }, undefined, { Origin: 'https://attacker.example' }); await s.flush();
  assert.ok(!s.emails[0].text.includes('attacker.example'));
  assert.ok(s.emails[0].text.includes('https://dashboard.example.test/'));
});

test('new signups and login continue to work with the upgraded password hash', async () => {
  const s = setup(), newEmail = 'new@example.test';
  const signup = await s.request('/auth/signup', { email: newEmail, password });
  assert.equal(signup.status, 200);
  assert.equal((await s.request('/auth/me', undefined, signup.body.token)).body.email, newEmail);
  assert.equal((await s.request('/auth/login', { email: newEmail, password })).status, 200);
  assert.equal((await s.request('/auth/signup', { email: newEmail, password })).status, 409);
});

test('revoked sessions cannot change passwords or delete an account after recovery', async () => {
  const s = setup(); await s.request('/auth/forgot-password', { email }); await s.flush();
  await s.request('/auth/reset-password', { token: s.tokenFrom(s.emails[0]), password: nextPassword });
  assert.equal((await s.request('/auth/password', { password: 'attacker-password' }, 'legacy-session-token')).status, 401);
  assert.equal((await s.request('/auth/delete', {}, 'legacy-session-token')).status, 401);
  assert.ok(s.values.get('account:' + email).includes('KEEP MY NOTES'));
  assert.equal((await s.request('/auth/login', { email, password: nextPassword })).status, 200);
});

test('an auth storage outage stays a service error rather than an expired session', async () => {
  const s = setup();
  s.setFault('auth-recovery-v1', method => { if (method === 'get') throw new Error('PRIVATE_STORAGE_DETAIL'); });
  const result = await s.request('/account/data', undefined, 'legacy-session-token');
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'auth_service_unavailable');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_STORAGE_DETAIL'));
  assert.ok(s.values.get('account:' + email).includes('KEEP MY NOTES'));
});

test('a failed reset commit keeps the old password and lets the same link retry', async () => {
  const s = setup(); await s.request('/auth/forgot-password', { email }); await s.flush();
  const token = s.tokenFrom(s.emails[0]);
  s.setFault('auth-recovery-v1', (method, key) => { if (method === 'put' && typeof key === 'object' && key['auth-user:' + email]) throw new Error('Commit unavailable'); });
  assert.equal((await s.request('/auth/reset-password', { token, password: nextPassword })).status, 503);
  assert.equal((await s.request('/auth/login', { email, password })).status, 200);
  s.setFault('auth-recovery-v1', null);
  assert.equal((await s.request('/auth/reset-password', { token, password: nextPassword })).status, 200);
});

test('a failed KV mirror cannot restore the old password or session after restart', async () => {
  const s = setup(); await s.request('/auth/forgot-password', { email }); await s.flush();
  s.env.SYNC.put = async () => { throw new Error('Mirror unavailable'); };
  assert.equal((await s.request('/auth/reset-password', { token: s.tokenFrom(s.emails[0]), password: nextPassword })).status, 200);
  s.restart();
  assert.equal((await s.request('/auth/login', { email, password })).status, 401);
  assert.equal((await s.request('/auth/me', undefined, 'legacy-session-token')).status, 401);
  assert.equal((await s.request('/auth/login', { email, password: nextPassword })).status, 200);
});

test('sign-in attempts are limited before repeated password hashing', async () => {
  const s = setup();
  for (let n = 0; n < 20; n++) assert.equal((await s.request('/auth/login', { email, password: 'wrong-password' })).status, 401);
  assert.equal((await s.request('/auth/login', { email, password })).status, 429);
});

test('deleted-account tombstones reject late snapshots until intentional signup', async () => {
  const s = setup();
  assert.equal((await s.request('/auth/delete', {}, 'legacy-session-token')).status, 200);
  const late = await s.env.DAILY_COORDINATOR.get('account:' + email).fetch('https://daily.internal/account', { method: 'POST', body: JSON.stringify({ email, snapshot: { updatedAt: 2, data: { fefe_notes: 'LATE PRIVATE DATA' } } }) });
  assert.equal(late.status, 403);
  assert.equal(s.values.has('account:' + email), false);
  const signup = await s.request('/auth/signup', { email, password: nextPassword });
  assert.equal(signup.status, 200);
  const fresh = await s.request('/account/data', undefined, signup.body.token);
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.body.data, {});
});

test('removing the auth coordinator cannot reactivate revoked legacy sessions', async () => {
  const s = setup(); await s.request('/auth/forgot-password', { email }); await s.flush();
  await s.request('/auth/reset-password', { token: s.tokenFrom(s.emails[0]), password: nextPassword });
  delete s.env.DAILY_COORDINATOR;
  for (const [path, body] of [['/auth/me', undefined], ['/account/data', undefined], ['/auth/login', { email, password }], ['/auth/signup', { email: 'other@example.test', password }], ['/auth/password', { password }], ['/auth/delete', {}]]) {
    const result = await s.request(path, body, 'legacy-session-token');
    assert.equal(result.status, 503, path);
  }
  assert.ok(s.values.get('account:' + email).includes('KEEP MY NOTES'));
});

test('Resend sends a real recovery payload and reports the test-sender recipient limit', async () => {
  const s = setup(); delete s.env.AUTH_EMAIL;
  s.env.RESEND_API_KEY = 'test-sending-only-key';
  s.env.AUTH_EMAIL_FROM = 'Password recovery <onboarding@resend.dev>';
  const original = globalThis.fetch, deliveries = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-sending-only-key');
    deliveries.push(JSON.parse(options.body));
    return Response.json({ id: 'test-delivery' });
  };
  try {
    const result = await s.request('/auth/forgot-password', { email }); await s.flush();
    assert.equal(result.status, 200);
    assert.equal(result.body.ownerOnly, true);
    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0].to, [email]);
    assert.equal(deliveries[0].from, s.env.AUTH_EMAIL_FROM);
    assert.ok(s.tokenFrom(deliveries[0]));
    assert.ok(deliveries[0].text.includes('https://dashboard.example.test/'));
    assert.ok(!JSON.stringify(result).includes('test-sending-only-key'));
  } finally { globalThis.fetch = original; }
});
