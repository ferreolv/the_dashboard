const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The streak calendar's rules (ice spending, where an ice may go, links, streak length)
// run in the page; extract them as written.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* STREAK_CORE_START */'), end = html.indexOf('/* STREAK_CORE_END */');
assert.ok(start >= 0 && end > start, 'streak core must be extractable');
const context = vm.createContext({});
vm.runInContext([
  'const pad=n=>String(n).padStart(2,"0");',
  'const dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;',
  'function addDays(key,n){ const [y,m,d]=key.split("-").map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n); return dateKey(dt); }',
  html.slice(start, end),
  'this.api = {addDays, iceUsed, canPlaceIce, calendarRuns, streakFrom};'
].join('\n'), context);
const api = context.api;
const plain = value => JSON.parse(JSON.stringify(value));
const TODAY = '2026-11-04';
const day = n => api.addDays(TODAY, n);

test('an ice is spent by a habit cover or a placed day, never by a day that reached 100%', () => {
  const perfect = new Set([day(-2)]);
  assert.equal(api.iceUsed(2, [day(-3), day(-2)], k => perfect.has(k)), 3);
  assert.equal(api.iceUsed(0, undefined, () => false), 0);
});

test('an ice can only go on a missed past day of the tracked period', () => {
  const opts = (k, extra = {}) => ({ today: TODAY, firstDay: day(-20), lit: false, iced: false, ...extra });
  assert.equal(api.canPlaceIce(day(-1), opts(day(-1))), true);
  assert.equal(api.canPlaceIce(TODAY, opts(TODAY)), false, 'today is not over yet');
  assert.equal(api.canPlaceIce(day(-1), opts(day(-1), { lit: true })), false, 'a flame needs no ice');
  assert.equal(api.canPlaceIce(day(-1), opts(day(-1), { iced: true })), false, 'already iced');
  assert.equal(api.canPlaceIce(day(-21), opts(day(-21))), false, 'before tracking began');
});

test('flames and ices link into one band per week row', () => {
  const days = Array.from({ length: 14 }, (_, i) => day(i - 13));
  const linked = new Set([5, 6, 7, 8].map(i => days[i]));
  const runs = plain(api.calendarRuns(days, k => linked.has(k)));
  assert.deepEqual(runs.slice(4, 10), [
    { on: false, start: false, end: false },
    { on: true, start: true, end: false },
    { on: true, start: false, end: true },
    { on: true, start: true, end: false },
    { on: true, start: false, end: true },
    { on: false, start: false, end: false }
  ], 'the band breaks at the end of a week row and starts again on the next');
});

test('an ice keeps the streak going and counts as part of it', () => {
  const flames = new Set([day(-3), day(-2)]), ices = new Set([day(-1)]);
  const streak = done => api.streakFrom(done, TODAY, api.addDays);
  assert.equal(streak(k => flames.has(k)), 0, 'without the ice, yesterday breaks the run');
  assert.equal(streak(k => flames.has(k) || ices.has(k)), 3, 'today may still be pending');
  flames.add(TODAY);
  assert.equal(streak(k => flames.has(k) || ices.has(k)), 4);
});
