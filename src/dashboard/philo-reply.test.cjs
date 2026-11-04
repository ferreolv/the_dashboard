const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Philosophy's reply path (daily server first, the key in Settings as the fallback) runs in the
// page; extract it as written and drive it with a fake network.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* PHILO_REPLY_START */'), end = html.indexOf('/* PHILO_REPLY_END */');
assert.ok(start >= 0 && end > start, 'the Philosophy reply block must be extractable');

const CLAUDE = 'https://api.anthropic.com/v1/messages';
function page({ key = '', token = '', routes = {} } = {}) {
  const calls = [];
  const context = vm.createContext({
    SHARED_URL: 'https://daily.test',
    getKey: () => key,
    getAccountToken: () => token,
    philoModeLabel: id => ({ searle: 'Searle' })[id] || 'Socrates',
    navigator: { onLine: true },
    AbortSignal: { timeout: () => undefined },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      const route = url === CLAUDE ? routes.claude : routes.server;
      if (!route) throw new Error('unexpected request to ' + url);
      return route(calls.at(-1).body, calls.filter(c => c.url === url).length);
    },
    Response
  });
  vm.runInContext(html.slice(start, end) + '\nthis.philoReply = philoReply;', context);
  return { reply: context.philoReply, calls };
}
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const claudeText = text => json(200, { content: [{ type: 'text', text }] });
const history = [{ role: 'user', text: 'Only if it can feel.' }];

test('signed in, the daily server answers first and the key in Settings is never sent', async () => {
  const p = page({ key: 'sk-personal', token: 't', routes: { server: () => json(200, { reply: 'From the server.' }), claude: () => claudeText('From the key.') } });
  assert.equal(await p.reply('Q?', history), 'From the server.');
  assert.deepEqual(p.calls.map(c => c.url), ['https://daily.test/philo/reply']);
});

test('when the daily server is not updated yet, the key in Settings answers with the same prompt', async () => {
  const p = page({ key: 'sk-personal', token: 't', routes: { server: () => json(404, {}), claude: () => claudeText('From the key.') } });
  assert.equal(await p.reply('Could a simulation feel?', history, 'searle'), 'From the key.');
  const sent = p.calls.find(c => c.url === CLAUDE);
  assert.equal(sent.headers['x-api-key'], 'sk-personal');
  assert.match(sent.body.system, /Searle/);
  assert.match(sent.body.system, /Could a simulation feel\?/);
  assert.deepEqual(sent.body.messages, [{ role: 'user', content: 'Only if it can feel.' }]);
});

test('a model the key cannot use (403) gives way to the next model instead of calling the key invalid', async () => {
  const denied = { type: 'error', error: { type: 'permission_error', message: 'Access to this model requires an access grant your request does not have.' } };
  const p = page({ key: 'sk-personal', routes: { claude: (body, n) => n === 1 ? json(403, denied) : claudeText('From the next model.') } });
  assert.equal(await p.reply('Q?', history), 'From the next model.');
  const models = p.calls.map(c => c.body.model);
  assert.equal(models.length, 2, 'signed out, so the server is not asked');
  assert.notEqual(models[0], models[1]);
});

test('only a key Claude rejects (401) asks for a new key, in Claude’s words, and says what the server needs', async () => {
  const p = page({ key: 'sk-old-secret', token: 't', routes: { server: () => json(404, {}), claude: () => json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) } });
  await assert.rejects(p.reply('Q?', history), e => {
    assert.equal(e.dailyState, 'invalid_key');
    assert.match(e.philoText, /rejected the API key saved in Settings/);
    assert.match(e.philoText, /invalid x-api-key/);
    assert.match(e.philoText, /updated worker/);
    assert.doesNotMatch(e.philoText, /sk-old-secret|Error:/);
    return true;
  });
  assert.equal(p.calls.filter(c => c.url === CLAUDE).length, 1, 'a rejected key is not retried on other models');
});

test('a billing problem is named as such, never as a bad key', async () => {
  const p = page({ key: 'sk', routes: { claude: () => json(402, { type: 'error', error: { type: 'billing_error', message: 'Your credit balance is too low.' } }) } });
  await assert.rejects(p.reply('Q?', history), e => e.dailyState === 'error' && /billing problem/.test(e.philoText) && /credit balance/.test(e.philoText));
});

test('with no key and no sign-in, Philosophy asks to sign in without calling anything', async () => {
  const p = page();
  await assert.rejects(p.reply('Q?', history), e => e.dailyState === 'signin_required');
  assert.equal(p.calls.length, 0);
});
