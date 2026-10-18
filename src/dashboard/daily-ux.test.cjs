const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Run the live page's decision logic without React, the network, or browser storage.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
function extractContract(name) {
  const start = `/* ${name}_START */`, end = `/* ${name}_END */`;
  const startAt = html.indexOf(start), endAt = html.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0 && endAt > startAt, `${name} markers must exist in index.html`);
  return html.slice(startAt + start.length, endAt);
}
function harness(online = true) {
  const context = vm.createContext({navigator: {onLine: online}});
  vm.runInContext(
    extractContract('DAILY_CONTENT_CONTRACT') + '\n' + extractContract('DAILY_UX_CONTRACT') +
    '\nthis.contract = {dailyIssueInfo, dailyRefreshPlan, dailyRequestFailure, readDailyResponse};',
    context
  );
  return context.contract;
}
const {dailyIssueInfo, dailyRefreshPlan, dailyRequestFailure, readDailyResponse} = harness();
const plain = value => JSON.parse(JSON.stringify(value));
const word = {term_en: 'Lucid', def_en: 'Clear and easy to understand.', term_fr: 'Clair', quiz: {options: ['Clear', 'Cloudy'], answer: 0}};
const music = {title: 'A recording', artist: 'An ensemble', why: 'A specific reason.'};
const response = (status, doc) => ({status, ok: status >= 200 && status < 300, json: async () => doc});

test('shared service keys and personal Study keys lead to different recovery actions', () => {
  for (const state of ['missing_key', 'invalid_key']) {
    const shared = dailyIssueInfo('word', state), study = dailyIssueInfo('academic', state);
    assert.equal(shared.actionType, 'settings');
    assert.match(shared.detail, /shared|service/i);
    assert.match(shared.detail, /Cloudflare/);
    assert.equal(study.actionType, 'key');
    assert.match(study.action, /API key/);
    assert.doesNotMatch(study.detail, /Cloudflare/);
  }
  assert.match(dailyIssueInfo('word', 'missing_key').detail, /personal key won’t fix/);
  assert.equal(dailyIssueInfo('academic', 'personal_key').actionType, 'key');
});

test('a disabled tile offers enabling it rather than a retry that cannot work', () => {
  const issue = dailyIssueInfo('word', 'disabled');
  assert.equal(issue.actionType, 'enable');
  assert.match(issue.action, /enable.*load/i);
  assert.match(issue.detail, /Settings/);
});

test('expired sign-in and unreachable account storage have distinct recovery actions', () => {
  const expired = dailyIssueInfo('account', 'signin_required');
  assert.equal(expired.actionType, 'signin');
  assert.equal(expired.action, 'Sign in');
  assert.match(expired.detail, /saved content remains/i);
  const disconnected = dailyIssueInfo('account', 'sync_pending');
  assert.equal(disconnected.actionType, 'retry');
  assert.match(disconnected.action, /connection/i);
  assert.match(disconnected.detail, /saved day/i);
});

test('course, browser, and service setup failures point to their actual prerequisite', () => {
  assert.equal(dailyIssueInfo('academic', 'missing_course').actionType, 'courses');
  for (const state of ['server_unconfigured', 'service_update']) {
    assert.equal(dailyIssueInfo('word', state).actionType, 'settings', state);
  }
  const unsupported = dailyIssueInfo('word', 'browser_lock_unavailable');
  assert.equal(unsupported.actionType, 'none');
  assert.equal(unsupported.action, null);
  assert.match(unsupported.detail, /browser|Chrome|Safari/i);
});

test('transient load problems stay actionable and incomplete content is never described as loaded', () => {
  for (const state of ['offline', 'timeout', 'rate_limit', 'invalid_content', 'bad_response', 'server_storage_error', 'storage_error', 'processing', 'interrupted', 'service_error', 'error']) {
    const issue = dailyIssueInfo('word', state);
    assert.equal(issue.state, state);
    assert.equal(issue.actionType, 'retry', state);
    assert.ok(issue.title && issue.detail && issue.action, state);
  }
  assert.match(dailyIssueInfo('word', 'invalid_content').detail, /not shown or marked as loaded/i);
  assert.match(dailyIssueInfo('word', 'timeout').detail, /saved result first/i);
  assert.match(dailyIssueInfo('weather', 'missing').detail, /no API key/i);
});

test('refresh initially offers loading all requested daily tiles', () => {
  const plan = dailyRefreshPlan(['word', 'music'], {}, {});
  assert.equal(plan.label, 'Load all tiles');
  assert.deepEqual(plain(plan.missing), ['word', 'music']);
  assert.deepEqual(plain(plan.loadable), ['word', 'music']);
  assert.deepEqual(plain(plan.blocked), []);
  assert.deepEqual(plain(plan.failed), []);
});

test('a partial saved day loads only the gap and keeps a valid saved tile out of the action', () => {
  const plan = dailyRefreshPlan(['word', 'music'], {word, music: {}}, {});
  assert.equal(plan.label, 'Load missing (1)');
  assert.deepEqual(plain(plan.loadable), ['music']);
  assert.match(plan.detail, /Saved content and progress are kept/);
});

test('failed loads make refresh a retry and include all loadable gaps in its count', () => {
  const plan = dailyRefreshPlan(['word', 'music'], {}, {word: {state: 'timeout'}, music: {state: 'missing'}});
  assert.equal(plan.label, 'Retry 2 tiles');
  assert.deepEqual(plain(plan.failed), ['word']);
  assert.deepEqual(plain(plan.loadable), ['word', 'music']);
  const single = dailyRefreshPlan(['word', 'music'], {music}, {word: {state: 'error'}});
  assert.equal(single.label, 'Retry 1 tile');
});

test('setup-only gaps offer setup, excluding disabled and unconfigured tiles from loading', () => {
  const status = {word: {state: 'missing_key'}, music: {state: 'disabled'}, academic: {state: 'missing_course'}};
  const plan = dailyRefreshPlan(['word', 'music', 'academic'], {}, status);
  assert.equal(plan.label, 'Finish setup (3)');
  assert.deepEqual(plain(plan.blocked), ['word', 'music', 'academic']);
  assert.deepEqual(plain(plan.loadable), []);
  assert.deepEqual(plain(plan.failed), []);
});

test('a mixed setup and loadable day accurately offers only the loadable count', () => {
  const plan = dailyRefreshPlan(['word', 'music'], {}, {word: {state: 'missing_key'}});
  assert.equal(plan.label, 'Load missing (1)');
  assert.deepEqual(plain(plan.loadable), ['music']);
  assert.deepEqual(plain(plan.blocked), ['word']);
  assert.match(plan.detail, /1 missing tile/);
  assert.match(plan.detail, /1 need setup/);
});

test('saved content wins over stale failure or disabled statuses', () => {
  const plan = dailyRefreshPlan(['word', 'music'], {word, music}, {word: {state: 'error'}, music: {state: 'disabled'}});
  assert.equal(plan.label, 'All saved ✓');
  for (const field of ['missing', 'loadable', 'blocked', 'failed']) assert.deepEqual(plain(plan[field]), [], field);
  assert.match(plan.detail, /Nothing will be replaced/);
});

test('refresh stays scoped to the current tiles and removes duplicate requests', () => {
  const keys = ['music', 'word', 'music', 'word'];
  const content = {word};
  const status = {academic: {state: 'missing_course'}, music: {state: 'offline'}};
  const before = structuredClone({keys, content, status});
  const plan = dailyRefreshPlan(keys, content, status);
  assert.deepEqual(plain(plan.missing), ['music']);
  assert.deepEqual(plain(plan.loadable), ['music']);
  assert.equal(plan.label, 'Retry 1 tile');
  assert.deepEqual({keys, content, status}, before);
});

test('refresh labels busy, reconnecting, and empty scopes explicitly', () => {
  assert.equal(dailyRefreshPlan(['word'], {}, {}, true, true).label, 'Loading tiles…');
  const reconnect = dailyRefreshPlan(['word'], {}, {}, false, true);
  assert.equal(reconnect.label, 'Reconnect');
  assert.match(reconnect.detail, /saved account day before loading/i);
  const empty = dailyRefreshPlan([], {}, {});
  assert.equal(empty.label, 'No daily tiles');
  assert.deepEqual(plain(empty.loadable), []);
});

test('untyped HTTP failures preserve the useful recovery category without leaking server errors', async () => {
  for (const [http, state] of [[401, 'signin_required'], [403, 'signin_required'], [404, 'service_update'], [405, 'service_update'], [429, 'rate_limit'], [500, 'service_error'], [503, 'service_error']]) {
    await assert.rejects(readDailyResponse(response(http, {error: 'private stack trace: sk-ant-secret'})), error => {
      assert.equal(error.dailyState, state, String(http));
      assert.match(error.message, new RegExp(`HTTP ${http}`));
      assert.doesNotMatch(error.message, /private stack|sk-ant-secret/);
      return true;
    });
  }
});

test('unreadable JSON becomes an explicit bad-response issue even on a successful HTTP status', async () => {
  for (const status of [200, 502]) {
    await assert.rejects(readDailyResponse({status, ok: status === 200, json: async () => {throw new SyntaxError('Unexpected <html> with private data');}}), error => {
      assert.equal(error.dailyState, 'bad_response');
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /private data|<html>/);
      return true;
    });
  }
});

test('typed service statuses survive HTTP errors so the tile can offer the right next action', async () => {
  for (const state of ['missing_key', 'invalid_key', 'disabled', 'processing', 'server_unconfigured', 'invalid_content', 'server_storage_error']) {
    const payload = {status: state, key: 'word'};
    assert.equal(await readDailyResponse(response(503, payload)), payload, state);
  }
  const saved = {status: 'ready', content: {word}};
  assert.equal(await readDailyResponse(response(200, saved)), saved);
});

test('timeouts and aborted fetches are explained as retryable timeouts', () => {
  for (const name of ['TimeoutError', 'AbortError']) {
    assert.deepEqual(plain(dailyRequestFailure({name, message: 'raw browser exception'})), {state: 'timeout'});
  }
});

test('blocked or full browser storage is distinguished from network problems', () => {
  const offline = harness(false).dailyRequestFailure;
  for (const name of ['QuotaExceededError', 'SecurityError']) {
    assert.deepEqual(plain(offline({name, message: 'private storage failure'})), {state: 'storage_error'});
  }
});

test('offline failures use connection recovery and generic exceptions never become fake content', () => {
  const raw = new Error('Error: private raw service trace sk-ant-secret');
  const issue = harness(false).dailyRequestFailure(raw);
  assert.equal(issue.state, 'offline');
  assert.match(issue.message, /connection/i);
  const online = dailyRequestFailure(raw);
  assert.equal(online.state, 'error');
  assert.doesNotMatch(online.message, /private|sk-ant|Error:/);
  assert.doesNotMatch(dailyIssueInfo('philo', online.state, online.message).detail, /private|sk-ant|Error:/);
});

test('typed failures and safety prerequisites remain specific, including while offline', () => {
  const offline = harness(false).dailyRequestFailure;
  assert.deepEqual(plain(offline({dailyState: 'signin_required', message: 'Sign in again.'})), {state: 'signin_required', message: 'Sign in again.'});
  for (const [message, state] of [['browser_lock_unavailable', 'browser_lock_unavailable'], ['wrong_day', 'service_update'], ['invalid_content', 'invalid_content']]) {
    assert.deepEqual(plain(offline({message})), {state}, message);
  }
});

function philosophyHarness(chat = {initial: 'An existing reflection', messages: [], mode: 'standard'}, hasKey = true, failure = new Error('Error: private raw service trace sk-ant-secret')) {
  const start = html.indexOf('const setPhiloMode=mode=>');
  const end = html.indexOf('/* ---- drag engine', start);
  assert.ok(start >= 0 && end > start, 'Philosophy chat actions must be extractable');
  const saved = [], errors = [], busy = [], popups = [];
  const context = vm.createContext({
    daily: {philo: {question: 'What makes a reason persuasive?'}},
    philoChat: structuredClone(chat),
    getKey: () => hasKey ? 'test-key' : '',
    persistPhiloChat: value => saved.push(plain(value)),
    setRitual: () => {},
    setPhiloError: value => errors.push(value),
    setPhiloBusy: value => busy.push(value),
    showLoadProblems: issues => popups.push(plain(issues)),
    dailyIssueInfo,
    dailyRequestFailure,
    philoReply: async () => {throw failure;}
  });
  vm.runInContext(html.slice(start, end) + '\nthis.chatActions = {philoSubmitInitial, philoSend};', context);
  return {...context.chatActions, saved, errors, busy, popups};
}

test('a failed Philosophy reply keeps the reflection and shows a separate error instead of an invented chat reply', async () => {
  const chat = philosophyHarness();
  await chat.philoSubmitInitial('My own reflection');
  assert.deepEqual(chat.saved, [{initial: 'My own reflection', messages: [], mode: 'standard'}]);
  assert.match(chat.errors.at(-1), /reflection is saved/i);
  assert.doesNotMatch(chat.errors.at(-1), /private|sk-ant|Error:/);
  assert.deepEqual(chat.busy, [true, false]);
  assert.equal(chat.popups.length, 1);
  assert.equal(chat.popups[0][0].key, 'philo');
  assert.equal(chat.popups[0][0].actionType, 'retry');
  assert.doesNotMatch(chat.popups[0][0].detail, /private|sk-ant|Error:/);
});

test('failed Philosophy sends preserve the user message and retries never duplicate it', async () => {
  const send = philosophyHarness();
  await send.philoSend('My follow-up');
  assert.equal(send.saved.length, 1);
  assert.deepEqual(send.saved[0].messages, [{role: 'user', text: 'My follow-up'}]);
  assert.match(send.errors.at(-1), /message is saved/i);
  assert.doesNotMatch(send.errors.at(-1), /private|sk-ant|Error:/);
  assert.equal(send.popups[0][0].key, 'philo');
  assert.equal(send.popups[0][0].state, 'error');
  const retry = philosophyHarness(send.saved[0]);
  await retry.philoSend('', true);
  assert.deepEqual(retry.saved[0], send.saved[0]);
  assert.deepEqual(retry.busy, [true, false]);
  assert.equal(retry.popups.length, 1);
});

test('a missing personal chat key saves the reflection and gives setup guidance without attempting a reply', async () => {
  const chat = philosophyHarness(undefined, false);
  await chat.philoSubmitInitial('A reflection worth keeping');
  assert.equal(chat.saved[0].initial, 'A reflection worth keeping');
  assert.deepEqual(chat.saved[0].messages, []);
  assert.match(chat.errors.at(-1), /API key in Settings/);
  assert.deepEqual(chat.busy, []);
  assert.equal(chat.popups[0][0].state, 'personal_key');
  assert.equal(chat.popups[0][0].actionType, 'key');
});

test('a rejected Philosophy key opens personal-key recovery instead of shared-service setup', async () => {
  const failure = Object.assign(new Error('The personal API key was rejected.'), {dailyState: 'invalid_key'});
  const chat = philosophyHarness(undefined, true, failure);
  await chat.philoSend('A saved question');
  const issue = chat.popups[0][0];
  assert.equal(issue.key, 'philo');
  assert.equal(issue.state, 'invalid_key');
  assert.equal(issue.actionType, 'key');
  assert.match(issue.action, /Update API key/);
  assert.doesNotMatch(issue.detail, /Cloudflare|shared service/);
  assert.deepEqual(chat.saved[0].messages, [{role: 'user', text: 'A saved question'}]);
});

const quizQuestions = [
  {prompt: 'First question?', options: ['Yes', 'No'], answer: 0},
  {prompt: 'Second question?', options: ['First', 'Second'], answer: 1}
];
const quizKey = question => JSON.stringify([question.prompt, question.options, question.answer]);
function savedQuizHarness(storage, day = '2026-10-18') {
  const start = html.indexOf('function savedDailyQuizAnswers('), end = html.indexOf('function Quiz(', start);
  assert.ok(start >= 0 && end > start, 'Saved quiz-answer restoration must be extractable');
  const reads = [];
  const context = vm.createContext({
    todayKey: day,
    load: (key, fallback) => {reads.push(key); return Object.hasOwn(storage, key) ? JSON.parse(storage[key]) : fallback;}
  });
  vm.runInContext(html.slice(start, end) + '\nthis.restore = savedDailyQuizAnswers;', context);
  return {restore: context.restore, reads};
}

test('partial quiz answers restore after reload without completing unanswered questions', () => {
  const storage = {'quizAnswers:2026-10-18': JSON.stringify({[quizKey(quizQuestions[0])]: 0})};
  const first = savedQuizHarness(storage), reloaded = savedQuizHarness(storage);
  assert.deepEqual(plain(first.restore(quizQuestions)), {0: true});
  assert.deepEqual(plain(reloaded.restore(structuredClone(quizQuestions))), {0: true});
  assert.equal(Object.keys(reloaded.restore(quizQuestions)).length, 1);
  assert.deepEqual(reloaded.reads, ['quizAnswers:2026-10-18', 'quizAnswers:2026-10-18']);
});

test('a saved wrong quiz answer still counts as answered after reload', () => {
  const storage = {'quizAnswers:2026-10-18': JSON.stringify({[quizKey(quizQuestions[0])]: 0, [quizKey(quizQuestions[1])]: 0})};
  const answers = savedQuizHarness(storage).restore(quizQuestions);
  assert.deepEqual(plain(answers), {0: true, 1: false});
  assert.equal(Object.keys(answers).length, quizQuestions.length);
});

test('undoing a persisted quiz answer reduces the restored completion count', () => {
  const saved = {[quizKey(quizQuestions[0])]: 0, [quizKey(quizQuestions[1])]: 0};
  const storage = {'quizAnswers:2026-10-18': JSON.stringify(saved)};
  const quiz = savedQuizHarness(storage);
  assert.equal(Object.keys(quiz.restore(quizQuestions)).length, 2);
  delete saved[quizKey(quizQuestions[0])];
  storage['quizAnswers:2026-10-18'] = JSON.stringify(saved);
  assert.deepEqual(plain(quiz.restore(quizQuestions)), {1: false});
  assert.equal(Object.keys(savedQuizHarness(storage).restore(quizQuestions)).length, 1);
});

test('restoring quiz answers rejects malformed indices rather than counting them as complete', () => {
  for (const invalid of [-1, 2, 0.5, '0', null, false]) {
    const storage = {'quizAnswers:2026-10-18': JSON.stringify({[quizKey(quizQuestions[0])]: invalid})};
    assert.deepEqual(plain(savedQuizHarness(storage).restore(quizQuestions)), {}, String(invalid));
  }
});

test('quiz restoration respects the saved day and the complete question identity', () => {
  const original = quizQuestions[0];
  const storage = {'quizAnswers:2026-10-17': JSON.stringify({[quizKey(original)]: 0})};
  assert.deepEqual(plain(savedQuizHarness(storage).restore(quizQuestions)), {});
  assert.deepEqual(plain(savedQuizHarness(storage, '2026-10-17').restore(quizQuestions)), {0: true});
  for (const changed of [{...original, prompt: 'Different question?'}, {...original, options: ['No', 'Yes']}, {...original, answer: 1}]) {
    assert.deepEqual(plain(savedQuizHarness(storage, '2026-10-17').restore([changed])), {});
  }
});
