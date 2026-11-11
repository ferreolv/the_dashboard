const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The Priorities tile's note logic runs in the page; extract it as written.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* MATRIX_CORE_START */'), end = html.indexOf('/* MATRIX_CORE_END */');
assert.ok(start >= 0 && end > start, 'matrix core must be extractable');
const api = vm.runInNewContext(html.slice(start, end) + ';({MATRIX_MAX,matrixAdd,matrixMove,matrixText,matrixRemove,matrixClean,matrixQuadrant,matrixNextColor})');
const plain = v => JSON.parse(JSON.stringify(v));

test('a new note starts empty where it was dropped, with its own colour and a slight tilt', () => {
  let notes = api.matrixAdd([], { id: 'a', x: .8, y: .2 });
  notes = api.matrixAdd(notes, { id: 'b' });
  assert.deepEqual(plain(notes).map(n => [n.id, n.text, n.x, n.y]), [['a', '', .8, .2], ['b', '', .5, .5]]);
  assert.notEqual(notes[0].c, notes[1].c, 'two notes in a row never share a colour');
  assert.ok(Math.abs(notes[0].r) <= 4);
  assert.deepEqual(plain(api.matrixAdd([], { id: 'c', x: 3, y: -1 })).map(n => [n.x, n.y]), [[1, 0]], 'positions stay on the board');
});

test('moving a note brings it to the front, a keyboard nudge keeps the order', () => {
  const notes = [{ id: 'a', text: 'A', x: .1, y: .1, c: 0, r: 0 }, { id: 'b', text: 'B', x: .2, y: .2, c: 1, r: 0 }];
  assert.deepEqual(plain(api.matrixMove(notes, 'a', .9, .05)).map(n => [n.id, n.x, n.y]), [['b', .2, .2], ['a', .9, .05]]);
  assert.deepEqual(plain(api.matrixMove(notes, 'a', 1.4, .5, false)).map(n => [n.id, n.x]), [['a', 1], ['b', .2]]);
  assert.equal(api.matrixMove(notes, 'zz', .5, .5), notes, 'an unknown note changes nothing');
});

test('writing trims and caps the text; writing nothing takes the note off', () => {
  const notes = [{ id: 'a', text: '', x: .5, y: .5, c: 0, r: 0 }];
  assert.equal(api.matrixText(notes, 'a', '  Call   the bank \n today ')[0].text, 'Call the bank today');
  assert.equal(api.matrixText(notes, 'a', 'x'.repeat(200))[0].text.length, api.MATRIX_MAX);
  assert.deepEqual(plain(api.matrixText(notes, 'a', '   ')), []);
  assert.deepEqual(plain(api.matrixRemove(notes, 'a')), []);
});

test('stored notes are cleaned: bad entries dropped, values brought back in range', () => {
  const clean = plain(api.matrixClean([null, { id: 'a', text: 'Tax', x: 2, y: '0.3', c: 7, r: 40 }, { id: 5, x: 0, y: 0 }, { id: 'b', x: 'no', y: 0 }]));
  assert.deepEqual(clean, [{ id: 'a', text: 'Tax', x: 1, y: .3, c: 2, r: 6 }]);
  assert.deepEqual(plain(api.matrixClean('nope')), []);
});

test('the quadrant reads from the position: up is important, right is urgent', () => {
  assert.equal(api.matrixQuadrant(.8, .2), 'Important and urgent');
  assert.equal(api.matrixQuadrant(.2, .2), 'Important, not urgent');
  assert.equal(api.matrixQuadrant(.8, .8), 'Urgent, not important');
  assert.equal(api.matrixQuadrant(.2, .8), 'Neither urgent nor important');
});
