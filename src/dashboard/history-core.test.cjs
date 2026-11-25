const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// History: the app and the server share one core (fixed periods, candidates, fallback), and the
// Recall card asks for the year among two near misses.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const worker = fs.readFileSync(path.resolve(__dirname, '../../worker/fefe-sync.js'), 'utf8');
const block = src => src.slice(src.indexOf('/* HISTORY_CORE_START */'), src.indexOf('/* HISTORY_CORE_END */'));

test('the app and the server use the same periods and the same picking rules', () => {
  assert.equal(block(html).replace('const HISTORY_PERIODS', 'var HISTORY_PERIODS'), block(worker));
});

test('the periods cover every year once, from the ancient world to now', () => {
  const ctx = vm.createContext({});
  vm.runInContext(block(html) + ';this.p=historyPeriod;this.P=HISTORY_PERIODS;', ctx);
  for (let i = 1; i < ctx.P.length; i++) assert.equal(ctx.P[i][0], ctx.P[i - 1][1] + 1, 'no gap and no overlap before ' + ctx.P[i][2]);
  assert.equal(ctx.p(-1000), 'Ancient world');
  assert.equal(ctx.p(1914), 'World wars');
  assert.equal(ctx.p(1991), 'Cold War');
  assert.equal(ctx.p(1992), 'Contemporary');
});

test('the Recall card offers the right year among two near misses, in order', () => {
  const start = html.indexOf('const historyYearOptions='), end = html.indexOf('/* personal fallback: Wikipedia directly');
  const ctx = vm.createContext({});
  vm.runInContext(block(html) + html.slice(start, end) + ';this.o=historyYearOptions;', ctx);
  for (const [year, seed] of [[1969, '2026-11-25'], [1453, '2026-05-29'], [-44, '2026-03-15'], [2025, '2026-01-01']]) {
    const options = JSON.parse(JSON.stringify(ctx.o(year, seed)));
    assert.equal(options.length, 3, JSON.stringify(options));
    assert.ok(options.includes(year < 0 ? `${-year} BC` : String(year)));
    assert.ok(options.every(o => o !== '0' && Number(String(o).replace(' BC', '')) <= 2026), JSON.stringify(options));
  }
});
