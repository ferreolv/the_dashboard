const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The calendar plans a reminder from one field: the words, plus a time or a day written in them.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* QUICK_REMINDER_START */'), end = html.indexOf('/* QUICK_REMINDER_END */');
assert.ok(start >= 0 && end > start, 'parseQuickReminder must be extractable');
const context = vm.createContext({
  addDays: (key, n) => { const [y, m, d] = key.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
});
vm.runInContext(html.slice(start, end) + ';this.parse = parseQuickReminder;', context);
const plain = v => JSON.parse(JSON.stringify(v));
const TODAY = '2026-11-13'; // a Friday
const parse = (text, base) => plain(context.parse(text, base || TODAY, TODAY));

test('plain words go on the chosen day, with no time', () => {
  assert.deepEqual(parse('Call mum'), { label: 'Call mum', date: TODAY, time: '' });
  assert.deepEqual(parse('Call mum', '2026-11-20'), { label: 'Call mum', date: '2026-11-20', time: '' });
});

test('a time anywhere in the words is taken out and kept', () => {
  assert.deepEqual(parse('Dentist 9:30'), { label: 'Dentist', date: TODAY, time: '09:30' });
  assert.deepEqual(parse('9h30 dentist'), { label: 'dentist', date: TODAY, time: '09:30' });
  assert.deepEqual(parse('Call mum at 6pm'), { label: 'Call mum', date: TODAY, time: '18:00' });
  assert.deepEqual(parse('Gym 18h'), { label: 'Gym', date: TODAY, time: '18:00' });
  assert.deepEqual(parse('Lunch 12:15pm'), { label: 'Lunch', date: TODAY, time: '12:15' });
  assert.equal(parse('Buy 2 croissants').time, '', 'a lone number is not a time');
  assert.equal(parse('Buy 2 croissants').label, 'Buy 2 croissants');
});

test('a day written in the words wins over the chosen day', () => {
  assert.equal(parse('Pay rent tomorrow', '2026-11-20').date, '2026-11-14');
  assert.equal(parse('Pay rent today', '2026-11-20').date, TODAY);
  assert.equal(parse('Haircut in 3 days').date, '2026-11-16');
  assert.equal(parse('Report in 2 weeks').date, '2026-11-27');
  assert.deepEqual(parse('Dinner with Lina on fri 20:00'), { label: 'Dinner with Lina', date: '2026-11-20', time: '20:00' });
  assert.equal(parse('Football monday').date, '2026-11-16');
  assert.equal(parse('Concert nov 20').date, '2026-11-20');
  assert.equal(parse('Concert 20 november').date, '2026-11-20');
  assert.equal(parse('Renew passport jan 5').date, '2027-01-05', 'a date already past this year is next year');
});

test('short weekday words only count after "on" or "next", so ordinary words stay words', () => {
  assert.deepEqual(parse('Buy sun cream'), { label: 'Buy sun cream', date: TODAY, time: '' });
  assert.equal(parse('Run on sat').date, '2026-11-14');
  assert.equal(parse('Run on sat').label, 'Run');
});
