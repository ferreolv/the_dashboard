const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The FSRS scheduler, Word cloze helpers and the day's session model run in the page;
// extract them as written.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* RECALL_CORE_START */'), end = html.indexOf('/* RECALL_CORE_END */');
assert.ok(start >= 0 && end > start, 'recall core must be extractable');
const DAY = '2026-11-03';
const context = vm.createContext({});
vm.runInContext([
  'const pad=n=>String(n).padStart(2,"0");',
  'const dateKey=(d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;',
  'function addDays(key,n){ const [y,m,d]=key.split("-").map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n); return dateKey(dt); }',
  'function daysBetween(fromKey,toKey){ const [ay,am,ad]=fromKey.split("-").map(Number); const [by,bm,bd]=toKey.split("-").map(Number); return Math.round((new Date(by,bm-1,bd)-new Date(ay,am-1,ad))/86400000); }',
  `const todayKey=${JSON.stringify(DAY)};`,
  html.slice(start, end),
  'this.api = {recallPickRow, addDays, scheduleRecall, validCloze, clozeSentences, clozeParts, clozeFor, wordCardOf, upgradeWordCard, recallSourceOf, buildRecallSession, recallRowOrder, recallFrontier, recallSessionDone, recallSessionSize, recallOpenRow, recallStateBefore, gradeRecallEntry, recallEntryKey};'
].join('\n'), context);
const api = context.api;
const plain = value => JSON.parse(JSON.stringify(value));

const card = (id, type, nextReview, extra = {}) => ({
  id, type, addedOn: api.addDays(DAY, -10), nextReview, seen: 2, level: 0,
  quiz: { prompts: ['Q ' + id], options: ['a', 'b'], answer: 0, explain: 'because' },
  fsrs: { version: 6, state: 'review', stability: 3, difficulty: 5, reps: 2, lapses: 0, lastReview: api.addDays(nextReview, -3), scheduledDays: 3, desiredRetention: 0.9 },
  reviewLog: [{ date: api.addDays(nextReview, -3), rating: 3 }],
  ...extra
});

test('Word cloze sentences hide exactly the word, in any regular inflection', () => {
  assert.equal(api.validCloze('He was being very {abusive} with me.', 'abusive'), true);
  assert.equal(api.validCloze('They {obfuscated} the figures to avoid any blame.', 'obfuscate'), true);
  assert.equal(api.validCloze('He was being very abusive with me.', 'abusive'), false, 'no blank');
  assert.equal(api.validCloze('{Abusive} people stay {abusive} for years.', 'abusive'), false, 'two blanks');
  assert.equal(api.validCloze('She was very {kind} to him all day long.', 'abusive'), false, 'another word');
  assert.deepEqual(plain(api.clozeSentences(['A {terse} reply came back at once.', 'A {terse} reply came back at once.', 'no blank here at all', 7], 'terse')), ['A {terse} reply came back at once.']);
  assert.deepEqual(plain(api.clozeParts('He was being very {abusive} with me.')), { before: 'He was being very ', form: 'abusive', after: ' with me.' });
  const item = { cloze: ['One {terse} reply came.', 'Two {terse} words only.'], seen: 1 };
  assert.equal(api.clozeFor(item), 'Two {terse} words only.');
  assert.equal(api.clozeFor({ ...item, seen: 2 }), 'One {terse} reply came.', 'each review shows another sentence');
});

test('older Word cards become fill-in-the-blank cards with their schedule intact', () => {
  const old = card('w1', 'word', DAY, { title: 'Word · obfuscate', term: 'obfuscate', meta: 'En français : obscurcir', quiz: { prompts: ['Closest word to “obfuscate”?'], options: ['confuse', 'clarify'], answer: 0, explain: '“obfuscate” — to make something unclear.' } });
  const fromCard = api.upgradeWordCard(old, null);
  assert.deepEqual(plain(fromCard.word), { term: 'obfuscate', pos: '', ipa: '', def: 'to make something unclear.', fr: 'obscurcir' });
  for (const key of ['fsrs', 'nextReview', 'reviewLog', 'seen', 'id', 'addedOn']) assert.deepEqual(plain(fromCard[key]), plain(old[key]), key);
  const dayWord = { term_en: 'obfuscate', ipa: 'ˈɒbfʌskeɪt', pos: 'verb', def_en: 'Make something deliberately unclear.', term_fr: 'brouiller', cloze: ['Lawyers {obfuscated} the deal behind pages of fine print.'] };
  const fromDay = api.upgradeWordCard(old, dayWord);
  assert.deepEqual(plain(fromDay.word), { term: 'obfuscate', pos: 'verb', ipa: 'ˈɒbfʌskeɪt', def: 'Make something deliberately unclear.', fr: 'brouiller' });
  assert.deepEqual(plain(fromDay.cloze), dayWord.cloze);
  assert.equal(api.upgradeWordCard(fromDay, dayWord), fromDay, 'upgrading twice changes nothing');
  assert.deepEqual(plain(api.wordCardOf(dayWord)), plain(fromDay.word));
});

test('every due card is in the session, one row per tile, most overdue first', () => {
  const list = [];
  for (let i = 0; i < 30; i++) list.push(card('w' + i, 'word', api.addDays(DAY, -(i % 5))));
  list.push(card('s1', 'spanish', DAY), card('k1', 'lesson', api.addDays(DAY, -2)), card('later', 'german', api.addDays(DAY, 1)), { ...card('new', 'word', DAY), addedOn: DAY });
  const session = api.buildRecallSession(list, DAY, null);
  assert.equal(api.recallSessionSize(session), 32, 'no cap; not-yet-due and added-today cards stay out');
  assert.deepEqual(Object.keys(session.rows).sort(), ['lesson', 'spanish', 'word']);
  const reviewDates = plain(session.rows.word.map(e => list.find(x => x.id === e.id).nextReview));
  assert.deepEqual(reviewDates, [...reviewDates].sort(), 'most overdue first');
  assert.deepEqual(plain(api.recallRowOrder(session, ['spanish', 'goals', 'word', 'worth'])), ['spanish', 'word', 'lesson'], 'rows follow the tiles on the dashboard');
});

test('Again brings a card back at the end of its row; changing an earlier grade replays the card', () => {
  const list = [card('a', 'word', DAY), card('b', 'word', DAY), card('c', 'spanish', DAY)];
  const byId = id => list.find(x => x.id === id);
  let session = api.buildRecallSession(list, DAY, null);
  const grade = (key, index, rating) => {
    const entry = session.rows[key][index];
    const result = api.gradeRecallEntry(session, key, index, rating, byId(entry.id));
    session = result.session;
    list.splice(list.findIndex(x => x.id === entry.id), 1, result.item);
    return result.item;
  };
  // a: Again → it gets a second pass at the end of the Word row
  grade('word', 0, 1);
  assert.deepEqual(plain(session.rows.word.map(e => api.recallEntryKey(e))), ['a#1', 'b#1', 'a#2']);
  assert.equal(api.recallFrontier(session, 'word'), 1);
  grade('word', 1, 3);
  // the second pass previews from the state after the miss
  const afterMiss = api.scheduleRecall(card('a', 'word', DAY), 1, DAY);
  assert.deepEqual(plain(api.recallStateBefore(session, session.rows.word[2], byId('a')).fsrs), plain(afterMiss.fsrs));
  grade('word', 2, 3);
  assert.equal(api.recallFrontier(session, 'word'), -1);
  assert.equal(api.recallOpenRow(session, ['word', 'spanish'], 'word'), 'spanish', 'a finished row hands over to the next one');
  assert.equal(api.recallSessionDone(session), false);
  grade('spanish', 0, 4);
  assert.equal(api.recallSessionDone(session), true);
  assert.equal(byId('a').reviewLog.length, 3, 'two reviews today on top of the earlier one');
  // going back: the miss was a slip, it was actually Good → the extra pass disappears
  const replayed = grade('word', 0, 3);
  assert.deepEqual(plain(session.rows.word.map(e => api.recallEntryKey(e))), ['a#1', 'b#1']);
  assert.equal(session.grades['a#2'], undefined);
  const once = api.scheduleRecall(card('a', 'word', DAY), 3, DAY);
  assert.deepEqual(plain({ fsrs: replayed.fsrs, nextReview: replayed.nextReview, log: replayed.reviewLog.length }), plain({ fsrs: once.fsrs, nextReview: once.nextReview, log: once.reviewLog.length }));
  // and the other way round: a Good changed to Again adds a pass, so the session reopens
  grade('word', 1, 1);
  assert.deepEqual(plain(session.rows.word.map(e => api.recallEntryKey(e))), ['a#1', 'b#1', 'b#2']);
  assert.equal(api.recallSessionDone(session), false);
});

test('the day\'s session resumes after a reload and starts fresh the next day', () => {
  const list = [card('a', 'word', DAY), card('b', 'lesson', DAY), card('gone', 'word', DAY)];
  let session = api.buildRecallSession(list, DAY, null);
  session = api.gradeRecallEntry(session, 'word', 0, 1, list[0]).session;
  const stored = plain(session);
  const survivors = [list[0], list[1], card('fresh', 'word', api.addDays(DAY, -1))];
  const resumed = api.buildRecallSession(survivors, DAY, stored);
  assert.deepEqual(plain(resumed.rows.word.map(e => api.recallEntryKey(e))), ['a#1', 'a#2', 'fresh#1'], 'passes kept, deleted card dropped, newly due card added');
  assert.equal(resumed.grades['a#1'], 1);
  assert.ok(resumed.base.a, 'the pre-session state is kept for changing a grade later');
  const tomorrow = api.buildRecallSession(survivors, api.addDays(DAY, 1), stored);
  assert.deepEqual(plain(tomorrow.grades), {});
  assert.equal(tomorrow.rows.word.every(e => e.n === 1), true);
});

test('the next card mixes sources: most overdue first, never the same source twice running', () => {
  const day = DAY;
  const items = [
    { id: 'w1', type: 'word', nextReview: api.addDays(day, -5) }, { id: 'w2', type: 'word', nextReview: api.addDays(day, -4) }, { id: 'w3', type: 'word', nextReview: api.addDays(day, -3) },
    { id: 's1', type: 'spanish', nextReview: api.addDays(day, -2) }, { id: 's2', type: 'spanish', nextReview: api.addDays(day, -1) },
    { id: 'l1', type: 'lesson', nextReview: api.addDays(day, -6) }
  ];
  const byId = new Map(items.map(x => [x.id, x]));
  let session = api.buildRecallSession(items, day, null);
  const keys = api.recallRowOrder(session, ['word', 'worth', 'spanish']);
  const seen = []; let last = null;
  for (let step = 0; step < 6; step++) {
    const key = api.recallPickRow(session, keys, last, byId);
    const index = api.recallFrontier(session, key), entry = session.rows[key][index];
    seen.push(entry.id);
    session = api.gradeRecallEntry(session, key, index, 3, byId.get(entry.id)).session; last = key;
  }
  assert.deepEqual(seen, ['l1', 'w1', 's1', 'w2', 's2', 'w3'], 'the most overdue leads, then sources alternate while more than one has cards');
  assert.equal(api.recallPickRow(session, keys, last, byId), null, 'nothing left');
});

test('an Again pass waits behind the others\' first passes', () => {
  const day = DAY;
  const items = [{ id: 'a', type: 'word', nextReview: api.addDays(day, -3) }, { id: 'b', type: 'spanish', nextReview: api.addDays(day, -1) }, { id: 'c', type: 'german', nextReview: api.addDays(day, -1) }];
  const byId = new Map(items.map(x => [x.id, x]));
  let session = api.buildRecallSession(items, day, null);
  const keys = api.recallRowOrder(session, ['word', 'spanish', 'german']);
  let key = api.recallPickRow(session, keys, null, byId); assert.equal(key, 'word');
  session = api.gradeRecallEntry(session, key, 0, 1, byId.get('a')).session;
  const next = api.recallPickRow(session, keys, key, byId); assert.notEqual(next, 'word');
  session = api.gradeRecallEntry(session, next, 0, 3, byId.get(next === 'spanish' ? 'b' : 'c')).session;
  assert.notEqual(api.recallPickRow(session, keys, next, byId), 'word', 'the missed word comes back after the remaining first pass');
});
