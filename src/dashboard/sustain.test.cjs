const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The Sustainability tray's rules (the fixed list, bubble sizes, throwing, completion, streaks)
// run in the page; extract them as written.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* SUSTAIN_CORE_START */'), end = html.indexOf('/* SUSTAIN_CORE_END */');
assert.ok(start >= 0 && end > start, 'sustain core must be extractable');
const api = vm.runInNewContext(html.slice(start, end) + ';({SUSTAIN_ITEMS, sustainIsDone, sustainToggle, sustainRelease, sustainStreak})');
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const TODAY = '2026-11-05';
const plain = value => JSON.parse(JSON.stringify(value));
const ids = api.SUSTAIN_ITEMS.map(it => it.id);

test('the tray holds a fixed list of the heaviest everyday emitters, sized by their emissions', () => {
  assert.deepEqual(plain(ids), ['flight', 'beef', 'clothes', 'lamb', 'car', 'waste', 'cheese', 'parcel']);
  assert.equal(new Set(ids).size, ids.length);
  for (let i = 1; i < api.SUSTAIN_ITEMS.length; i++) {
    const a = api.SUSTAIN_ITEMS[i - 1], b = api.SUSTAIN_ITEMS[i];
    assert.ok(a.kg >= b.kg, `${a.id} weighs at least ${b.id}`);
    assert.ok(a.d >= b.d, `${a.id} is drawn at least as big as ${b.id}`);
  }
  for (const it of api.SUSTAIN_ITEMS) assert.ok(it.emoji && it.label && it.note && it.kg > 0, it.id + ' is described');
});

test('every bubble sits whole inside the tray and none overlaps another', () => {
  for (const it of api.SUSTAIN_ITEMS) {
    const r = it.d / 2;
    assert.ok(it.x - r >= 0 && it.x + r <= 100 && it.y - r >= 0 && it.y + r <= 100, it.id + ' stays inside the tray');
  }
  for (const a of api.SUSTAIN_ITEMS) for (const b of api.SUSTAIN_ITEMS) {
    if (a.id >= b.id) continue;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(dist >= (a.d + b.d) / 2 - 0.01, `${a.id} and ${b.id} do not overlap (${dist.toFixed(1)} < ${((a.d + b.d) / 2).toFixed(1)})`);
  }
});

test('a bubble leaves when dropped past the tile edge or flicked, otherwise it springs back', () => {
  const tile = { left: 100, top: 100, right: 292, bottom: 292 };
  assert.equal(api.sustainRelease({ cx: 180, cy: 180, tile, vx: 0, vy: 0 }), 'back');
  assert.equal(api.sustainRelease({ cx: 300, cy: 180, tile, vx: 0, vy: 0 }), 'out', 'past the right edge');
  assert.equal(api.sustainRelease({ cx: 180, cy: 96, tile, vx: 0, vy: 0 }), 'out', 'past the top edge');
  assert.equal(api.sustainRelease({ cx: 180, cy: 180, tile, vx: 1.4, vy: 0.2 }), 'out', 'a flick inside the tile still throws');
  assert.equal(api.sustainRelease({ cx: 180, cy: 180, tile, vx: 0.4, vy: 0.3 }), 'back', 'a slow drag inside the tile is not a throw');
});

test('throwing is in the tray or avoided, nothing else; the empty tray is the completed day', () => {
  let out = [];
  assert.equal(api.sustainIsDone(out), false);
  out = api.sustainToggle(out, 'beef', true);
  assert.deepEqual(plain(out), ['beef']);
  assert.equal(api.sustainToggle(out, 'beef', true), out, 'throwing an item already out changes nothing');
  assert.deepEqual(plain(api.sustainToggle(out, 'beef', false)), [], 'bringing it back empties the record');
  for (const id of ids) out = api.sustainToggle(out, id, true);
  assert.equal(api.sustainIsDone(out), true);
  assert.equal(api.sustainIsDone(api.sustainToggle(out, 'cheese', false)), false, 'one back in the tray undoes the day');
  assert.equal(api.sustainIsDone(['beef', 'beef', 'lamb']), false);
  assert.equal(api.sustainIsDone(undefined), false);
});

test('an item streak counts the days in a row it left the tray, through today once it has', () => {
  const days = { [TODAY]: ['beef'], [addDays(TODAY, -1)]: ['beef', 'lamb'], [addDays(TODAY, -2)]: ['beef'], [addDays(TODAY, -3)]: ['lamb'] };
  const thrownOn = k => k in days ? days[k] : null;
  assert.equal(api.sustainStreak('beef', thrownOn, TODAY, addDays), 3);
  assert.equal(api.sustainStreak('lamb', thrownOn, TODAY, addDays), 1, 'lamb is still in the tray today, so the streak counts from yesterday');
  assert.equal(api.sustainStreak('cheese', thrownOn, TODAY, addDays), 0);
  assert.equal(api.sustainStreak('beef', () => null, TODAY, addDays), 0, 'untracked days end the count');
});
