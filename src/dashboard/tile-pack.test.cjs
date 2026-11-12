const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Today's tiles are placed by packTiles: pins (where the user put a tile) first, newest pin
// first, then every other tile in order into the first free spot, so small tiles fill holes.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* TILE_PACK_START */'), end = html.indexOf('/* TILE_PACK_END */');
assert.ok(start >= 0 && end > start, 'packTiles must be extractable');
const packTiles = vm.runInNewContext(html.slice(start, end) + ';packTiles');
const plain = v => JSON.parse(JSON.stringify(v));

test('without pins, tiles flow in order and a small tile fills the hole a big one left', () => {
  const out = plain(packTiles([{ id: 'a', c: 4, r: 4 }, { id: 'b', c: 6, r: 2 }, { id: 'c', c: 2, r: 2 }], 8));
  assert.deepEqual(out.a, { x: 0, y: 0 });
  assert.deepEqual(out.b, { x: 0, y: 4 }, 'six wide does not fit beside the 4×4 on eight columns');
  assert.deepEqual(out.c, { x: 4, y: 0 }, 'the small tile backfills the hole to the right of a');
});

test('a pinned tile stays exactly where it was put, and the others flow around it', () => {
  const out = plain(packTiles([{ id: 'a', c: 2, r: 2 }, { id: 'b', c: 2, r: 2 }, { id: 'c', c: 2, r: 2 }], 6, { c: { x: 2, y: 3, t: 1 } }));
  assert.deepEqual(out.c, { x: 2, y: 3 });
  assert.deepEqual(out.a, { x: 0, y: 0 });
  assert.deepEqual(out.b, { x: 2, y: 0 });
});

test('the newest pin wins a clash; the older one moves straight down its column', () => {
  const items = [{ id: 'a', c: 4, r: 2 }, { id: 'b', c: 4, r: 2 }];
  const out = plain(packTiles(items, 8, { a: { x: 2, y: 0, t: 1 }, b: { x: 0, y: 0, t: 2 } }));
  assert.deepEqual(out.b, { x: 0, y: 0 });
  assert.deepEqual(out.a, { x: 2, y: 2 });
});

test('a dropped tile pushes only the tiles it lands on, which push the ones under them', () => {
  // a 2×2 tile dropped on top of a column: the two tiles under it slide down, the rest stay put
  const items = [{ id: 'top', c: 2, r: 2 }, { id: 'below', c: 2, r: 2 }, { id: 'side', c: 2, r: 2 }, { id: 'moved', c: 2, r: 2 }];
  const pins = { top: { x: 0, y: 0, t: 1 }, below: { x: 0, y: 2, t: 1 }, side: { x: 2, y: 0, t: 1 }, moved: { x: 0, y: 0, t: 9 } };
  const out = plain(packTiles(items, 4, pins));
  assert.deepEqual(out.moved, { x: 0, y: 0 });
  assert.deepEqual(out.top, { x: 0, y: 2 });
  assert.deepEqual(out.below, { x: 0, y: 4 });
  assert.deepEqual(out.side, { x: 2, y: 0 }, 'a tile out of the way never moves');
});

test('a pin past the right edge (fewer columns) is pulled back inside the grid', () => {
  const out = plain(packTiles([{ id: 'a', c: 4, r: 2 }], 4, { a: { x: 6, y: 1, t: 1 } }));
  assert.deepEqual(out.a, { x: 0, y: 1 });
});

test('tiles wider than the grid are clamped, never lost', () => {
  const out = plain(packTiles([{ id: 'a', c: 4, r: 4 }, { id: 'b', c: 1, r: 1 }], 2));
  assert.deepEqual(out, { a: { x: 0, y: 0 }, b: { x: 0, y: 4 } });
});
