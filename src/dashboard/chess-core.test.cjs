const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Brainflex chess: Lichess's moves are read and compared exactly, the board faces the side to move,
// and the chess day takes its turn in the rotation of four games.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* CHESS_CORE_START */'), end = html.indexOf('/* CHESS_CORE_END */');
assert.ok(start >= 0 && end > start, 'the chess core must be extractable');
const ctx = vm.createContext({});
vm.runInContext(html.slice(start, end) + ';this.api={chessUci,chessSameMove,chessPgnMoves,chessSquares};', ctx);
const { chessUci, chessSameMove, chessPgnMoves, chessSquares } = ctx.api;
const plain = v => JSON.parse(JSON.stringify(v));

test('solution moves in UCI become from/to/promotion, and only the right move matches', () => {
  assert.deepEqual(plain(chessUci('c4f7')), { from: 'c4', to: 'f7' });
  assert.deepEqual(plain(chessUci('e7e8q')), { from: 'e7', to: 'e8', promotion: 'q' });
  assert.equal(chessUci('z9z9'), null);
  assert.ok(chessSameMove({ from: 'c4', to: 'f7' }, chessUci('c4f7')));
  assert.ok(!chessSameMove({ from: 'c4', to: 'b5' }, chessUci('c4f7')));
  assert.ok(chessSameMove({ from: 'e7', to: 'e8', promotion: 'q' }, chessUci('e7e8')), 'a queen is the default promotion');
  assert.ok(!chessSameMove({ from: 'e7', to: 'e8', promotion: 'n' }, chessUci('e7e8q')));
});

test('a game record becomes its moves, with numbers, results and comments left out', () => {
  assert.deepEqual(plain(chessPgnMoves('e4 e5 Nf3 d6')), ['e4', 'e5', 'Nf3', 'd6']);
  assert.deepEqual(plain(chessPgnMoves('1. e4 e5 2. Nf3 {book} d6 3... Bg4 1-0')), ['e4', 'e5', 'Nf3', 'd6', 'Bg4']);
});

test('the side to move plays from the bottom of the board', () => {
  const w = plain(chessSquares('w')), b = plain(chessSquares('b'));
  assert.equal(w.length, 64);
  assert.deepEqual([w[0], w[7], w[56], w[63]], ['a8', 'h8', 'a1', 'h1']);
  assert.deepEqual([b[0], b[7], b[56], b[63]], ['h1', 'a1', 'h8', 'a8']);
});

test('four games take turns, so the chess puzzle comes every fourth day', () => {
  const s = html.indexOf('const brainDayNumber='), e = html.indexOf('\n', html.indexOf('const brainGameFor='));
  const c = vm.createContext({});
  vm.runInContext(html.slice(s, e) + ';this.f=brainGameFor;', c);
  const days = ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'].map(c.f);
  assert.equal(new Set(days).size, 4);
  assert.ok(days.includes('chess'));
});
