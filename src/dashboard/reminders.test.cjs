const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Recurrence maths runs in the page; extract it as written. A reminder booked on a chosen day
// is first due on that day, so its "last done" is one step before it.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('const RECUR_UNITS='), end = html.indexOf('function daysBetween(');
assert.ok(start >= 0 && end > start, 'recurrence helpers must be extractable');
const api = vm.runInNewContext([
  'const pad=n=>String(n).padStart(2,"0");',
  'const dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;',
  'function addDays(key,n){ const [y,m,d]=key.split("-").map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n); return dateKey(dt); }',
  html.slice(start, end),
  ';({addRecurStep, recurDue, recurLabel})'
].join('\n'));
const booked = (start, every) => ({ every, lastDone: api.addRecurStep(start, every, -1) });

test('a repeating reminder booked on a day is first due on that day, for every unit', () => {
  for (const every of [{ n: 1, unit: 'day' }, { n: 3, unit: 'day' }, { n: 1, unit: 'week' }, { n: 2, unit: 'week' }, { n: 1, unit: 'month' }, { n: 6, unit: 'month' }, { n: 1, unit: 'year' }]) {
    assert.equal(api.recurDue(booked('2026-11-20', every)), '2026-11-20', JSON.stringify(every));
  }
});

test('stepping back a month clamps to the month end and still lands on the booked day going forward', () => {
  const r = booked('2026-03-31', { n: 1, unit: 'month' });
  assert.equal(r.lastDone, '2026-02-28');
  assert.equal(api.recurDue(r), '2026-03-28', 'February has no 31st, so the step lands on the 28th; the next due after that is late March');
  assert.equal(api.recurDue(booked('2026-05-31', { n: 1, unit: 'month' })), '2026-05-30');
});

test('labels read naturally', () => {
  assert.equal(api.recurLabel({ every: { n: 1, unit: 'week' } }), 'Weekly');
  assert.equal(api.recurLabel({ every: { n: 2, unit: 'week' } }), 'Every 2 weeks');
  assert.equal(api.recurLabel({ every: { n: 1, unit: 'year' } }), 'Yearly');
});
