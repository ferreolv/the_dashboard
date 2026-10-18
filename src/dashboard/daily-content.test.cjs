const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the exact standalone-page contract without a browser, CDN, or API key.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = '/* DAILY_CONTENT_CONTRACT_START */';
const end = '/* DAILY_CONTENT_CONTRACT_END */';
const startAt = html.indexOf(start);
const endAt = html.indexOf(end, startAt + start.length);
assert.ok(startAt >= 0 && endAt > startAt, 'Daily-content contract markers must exist in index.html');
const context = vm.createContext({});
vm.runInContext(html.slice(startAt + start.length, endAt) + '\nthis.contract = {validDailyTile, mergeDailyContent, dailyRequestKeys};', context);
const { validDailyTile, mergeDailyContent, dailyRequestKeys } = context.contract;
// A result frozen by the server must also be renderable by the browser.
const workerSource = fs.readFileSync(path.resolve(__dirname, '../../worker/fefe-sync.js'), 'utf8');
const workerStart = workerSource.indexOf('/* ---------------- immutable daily records ---------------- */');
const workerEnd = workerSource.indexOf('function parseObject(', workerStart);
assert.ok(workerStart >= 0 && workerEnd > workerStart, 'Worker validation contract must be extractable');
const workerContext = vm.createContext({});
vm.runInContext(workerSource.slice(workerStart, workerEnd) + '\nthis.validate = validDailyContent;', workerContext);
const validServerTile = workerContext.validate;
const plain = value => JSON.parse(JSON.stringify(value));
const copy = value => structuredClone(value);
const quiz = {prompt: 'Which answer follows?', options: ['First', 'Second', 'Third'], answer: 0, explain: 'The first follows.'};
const fixtures = {
  word: {term_en: 'Lucid', def_en: 'Clear and easy to understand.', term_fr: 'Clair', def_fr: 'Facile à comprendre.', quiz: {options: ['Clear', 'Cloudy', 'Noisy'], answer: 0}},
  worth: {title: 'A working mechanism', category: 'Science', story: 'A complete lesson with enough context.', insight: 'Mechanisms connect causes and effects.', quiz: [copy(quiz), copy(quiz)]},
  spanish: {tema: 'Una conversación', punto: 'Una explicación con un ejemplo.', vocab: [{es: 'claro', en: 'clear'}, {es: 'luego', en: 'later'}, {es: 'ahora', en: 'now'}], quiz: [copy(quiz), copy(quiz)]},
  music: {title: 'An exact recording', artist: 'An identified ensemble', composer: '', year: '2001', genre: 'Jazz', why: 'A specific recording with complete performer credits.'},
  world: [{headline: 'A real headline', summary: 'A factual summary from the supplied news sources.'}],
  weather: {temp: 0, code: 0, hi: 0, lo: -2, tomorrow: {hi: 1, lo: 0, code: 0}, place: 'Sydney', timezone: 'Australia/Sydney', at: 1792188000000},
  brainflex: {format: 'Logic challenge', prompt: 'A complete challenge with all necessary information.', solution: 'A worked and self-contained solution.'},
  philo: {theme: 'Reasons and causes', question: 'What would make a reason a cause?'},
  academic: {courseId: 'course-1', courseName: 'A saved course', concept: 'A course concept', explain: 'A complete explanation from the uploaded notes.', bigPicture: 'How it fits into the course.', quiz: [copy(quiz), copy(quiz)]},
  gmat: Array.from({length: 5}, (_, index) => ({section: ['quant', 'verbal', 'data'][index % 3], skill: 'A tested skill', type: 'Practice', target: 120, ...copy(quiz), prompt: `Original practice question ${index + 1}?`}))
};
const keys = Object.keys(fixtures);

test('recognizes complete generated payloads, including zero-degree weather', () => {
  for (const key of keys) assert.equal(validDailyTile(key, fixtures[key]), true, key);
});

test('empty or primitive API results never masquerade as a loaded tile', () => {
  for (const key of keys) {
    for (const value of [undefined, null, false, true, 0, 1, '', 'Loading…', {}, []]) {
      assert.equal(validDailyTile(key, value), false, `${key}: ${JSON.stringify(value)}`);
    }
  }
});

test('a generated quiz must contain usable options and an integer answer in range', () => {
  for (const key of ['word', 'worth', 'spanish', 'academic', 'gmat']) {
    for (const malformed of [
      {options: [], answer: 0},
      {options: ['Only one'], answer: 0},
      {options: ['First', 'Second'], answer: -1},
      {options: ['First', 'Second'], answer: 2},
      {options: ['First', 'Second'], answer: 0.5},
      {options: ['First', 'Second'], answer: null}
    ]) {
      const value = copy(fixtures[key]);
      if (key === 'word') value.quiz = malformed;
      else if (key === 'gmat') value[0] = {...value[0], ...malformed};
      else value.quiz[0] = {...value.quiz[0], ...malformed};
      assert.equal(validDailyTile(key, value), false, `${key}: ${JSON.stringify(malformed)}`);
    }
  }
});

test('non-empty arrays with incomplete stories or questions remain retryable', () => {
  assert.equal(validDailyTile('world', [{headline: 'A headline'}]), false);
  assert.equal(validDailyTile('world', [{headline: '', summary: 'A summary'}]), false);
  assert.equal(validDailyTile('gmat', [{...fixtures.gmat[0], prompt: ''}]), false);
  assert.equal(validDailyTile('word', {...fixtures.word, term_en: '   '}), false);
  assert.equal(validDailyTile('brainflex', {...fixtures.brainflex, solution: ''}), false);
  assert.equal(validDailyTile('philo', {...fixtures.philo, question: ''}), false);
});

test('malformed array entries are rejected without crashing the dashboard', () => {
  for (const malformed of [null, false, 0, 'Incomplete result']) {
    assert.equal(validDailyTile('world', [malformed]), false);
    assert.equal(validDailyTile('gmat', [malformed]), false);
    assert.equal(validDailyTile('spanish', {...fixtures.spanish, vocab: [malformed]}), false);
    assert.equal(validDailyTile('worth', {...fixtures.worth, quiz: [malformed]}), false);
    assert.equal(validDailyTile('academic', {...fixtures.academic, quiz: [malformed]}), false);
  }
});

test('question aliases cannot freeze choices whose prompt the tile cannot render', () => {
  const questionOnly = {...copy(quiz), prompt: undefined, question: 'A question in the wrong field?'};
  for (const key of ['worth', 'spanish', 'academic', 'gmat']) {
    const value = copy(fixtures[key]);
    if (key === 'gmat') value[0] = {...value[0], ...questionOnly};
    else value.quiz[0] = copy(questionOnly);
    assert.equal(validDailyTile(key, value), false, key);
    assert.equal(validServerTile(key, value), false, `worker ${key}`);
  }
});

test('non-finite or malformed weather cannot be locked as a successful snapshot', () => {
  for (const value of [
    {...fixtures.weather, temp: null},
    {...fixtures.weather, temp: NaN},
    {...fixtures.weather, hi: Infinity},
    {...fixtures.weather, tomorrow: {}},
    {...fixtures.weather, tomorrow: {...fixtures.weather.tomorrow, lo: undefined}}
  ]) assert.equal(validDailyTile('weather', value), false);
});

test('the first valid result is kept through replacements, failures and later retries', () => {
  for (const key of keys) {
    const original = copy(fixtures[key]);
    const alternative = copy(fixtures[key]);
    if (key === 'world') alternative[0].headline = 'Different headline';
    else if (key === 'gmat') alternative[0].prompt = 'Different original practice question?';
    else if (key === 'weather') Object.assign(alternative, {temp: 8, hi: 8});
    else alternative[({word: 'term_en', worth: 'title', spanish: 'tema', music: 'title', brainflex: 'prompt', philo: 'question', academic: 'concept'})[key]] = 'A different valid result';
    assert.equal(validDailyTile(key, alternative), true, `replacement fixture: ${key}`);
    let result = mergeDailyContent({}, {[key]: original});
    for (const incoming of [alternative, null, {}, [], false, undefined]) {
      result = mergeDailyContent(result, {[key]: incoming});
      assert.deepEqual(plain(result[key]), original, key);
    }
  }
});

test('a failed first response remains fillable, then freezes at the first success', () => {
  for (const key of keys) {
    let result = mergeDailyContent({}, {[key]: null});
    assert.equal(validDailyTile(key, result[key]), false, key);
    result = mergeDailyContent(result, {[key]: fixtures[key]});
    assert.deepEqual(plain(result[key]), fixtures[key], key);
    const repeated = mergeDailyContent(result, {[key]: null});
    assert.deepEqual(plain(repeated[key]), fixtures[key], key);
  }
});

test('independent responses merge in either order without losing a successful tile', () => {
  const wordFirst = mergeDailyContent(mergeDailyContent({}, {word: fixtures.word}), {world: fixtures.world});
  const worldFirst = mergeDailyContent(mergeDailyContent({}, {world: fixtures.world}), {word: fixtures.word});
  assert.deepEqual(plain(wordFirst), plain(worldFirst));
  assert.deepEqual(plain(wordFirst.word), fixtures.word);
  assert.deepEqual(plain(wordFirst.world), fixtures.world);
});

test('merge preserves unrelated data and never mutates its inputs', () => {
  const existing = {word: copy(fixtures.word), personalAnnotation: {saved: true}};
  const incoming = {word: {...copy(fixtures.word), term_en: 'Another word'}, world: copy(fixtures.world)};
  const beforeExisting = copy(existing), beforeIncoming = copy(incoming);
  const result = mergeDailyContent(existing, incoming);
  assert.deepEqual(existing, beforeExisting);
  assert.deepEqual(incoming, beforeIncoming);
  assert.deepEqual(plain(result.personalAnnotation), {saved: true});
  assert.notEqual(result, existing);
});

test('requests only missing valid content and removes repeated tile keys', () => {
  const content = {word: copy(fixtures.word), world: [], weather: copy(fixtures.weather), philo: {question: ''}};
  const requested = ['word', 'world', 'world', 'weather', 'philo', 'word', 'academic'];
  const beforeKeys = copy(requested), beforeContent = copy(content);
  assert.deepEqual(plain(dailyRequestKeys(requested, content)), ['world', 'philo', 'academic']);
  assert.deepEqual(requested, beforeKeys);
  assert.deepEqual(content, beforeContent);
  assert.deepEqual(plain(dailyRequestKeys(keys, fixtures)), []);
  assert.deepEqual(plain(dailyRequestKeys([], {})), []);
});

test('browser and worker agree on every complete and malformed daily payload', () => {
  for (const key of keys) {
    const values = [copy(fixtures[key]), undefined, null, false, 0, '', 'Loading…', {}, [], [null], [false], [0]];
    if (key === 'word') {
      values.push({...fixtures.word, term_fr: ''}, {...fixtures.word, quiz: null});
    }
    if (['worth', 'spanish', 'academic'].includes(key)) {
      values.push({...fixtures[key], quiz: [copy(quiz)]}, {...fixtures[key], quiz: [null]}, {...fixtures[key], quiz: [{...quiz, prompt: undefined, question: 'Wrong property'}]});
    }
    if (key === 'spanish') values.push({...fixtures.spanish, vocab: [null]});
    if (key === 'academic') values.push({...fixtures.academic, bigPicture: ''});
    if (key === 'gmat') values.push([copy(fixtures.gmat[0])], [{...fixtures.gmat[0], section: undefined}], [null, null, null, null, null, null]);
    if (key === 'weather') {
      values.push({...fixtures.weather, hi: undefined}, {...fixtures.weather, lo: null}, {...fixtures.weather, tomorrow: {}}, {...fixtures.weather, tomorrow: {...fixtures.weather.tomorrow, lo: NaN}});
    }
    for (const value of values) {
      assert.equal(validServerTile(key, value), validDailyTile(key, value), `${key}: ${JSON.stringify(value)}`);
    }
  }
  assert.equal(validServerTile('unknown', fixtures.word), validDailyTile('unknown', fixtures.word));
});
