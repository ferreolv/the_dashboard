const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The built-in banks and puzzle generators run in the page; extract them as written.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const slice = (from, to) => {
  const start = html.indexOf(from), end = html.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} must be extractable`);
  return html.slice(start, end);
};
const context = vm.createContext({});
vm.runInContext([
  slice('/* DAILY_CONTENT_CONTRACT_START */', '/* DAILY_CONTENT_CONTRACT_END */'),
  slice('const GERMAN_BANK=', '/* ---- Brainflex: daily puzzles'),
  slice('const BRAIN_WORDS=', 'const sudokuSolved='),
  'const sudokuSolved=grid=>grid.every(row=>row.every(Boolean))&&sudokuConflicts(grid).size===0;',
  slice('const PHILO_MAX_WORDS=', '/* Philosophy: a genuinely advanced daily theme'),
  'this.api = {validDailyTile, GERMAN_BANK, germanBankLesson, BRAIN_WORDS, makeDigits, applyBrainOp, makeSudoku, sudokuSolved, scoreBrainGuess, brainGameFor, PHILO_BANK, PHILO_MAX_WORDS, philoWordCount, philoBankEntry, philoQuestionOf};'
].join('\n'), context);
const api = context.api;
const days = Array.from({length: 120}, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10));

test('every built-in German lesson is a complete, renderable daily tile', () => {
  for (const day of days) {
    const lesson = api.germanBankLesson(day);
    assert.equal(api.validDailyTile('german', lesson), true, day);
    for (const q of lesson.quiz) assert.ok(q.answer >= 0 && q.answer < q.options.length, day);
  }
  // Each lesson's correct answer is the first option as authored, wherever the shuffle puts it.
  for (const day of days.slice(0, api.GERMAN_BANK.length)) {
    const lesson = api.germanBankLesson(day);
    const authored = api.GERMAN_BANK.find(entry => entry[0] === lesson.thema)[3];
    lesson.quiz.forEach((q, i) => assert.equal(q.options[q.answer], authored[i][1][0], day));
  }
});

test('Philosophy shows a short question: long served questions give way to the bank', () => {
  for (const [, question] of api.PHILO_BANK) assert.ok(api.philoWordCount(question) <= api.PHILO_MAX_WORDS, question);
  for (const day of days) assert.equal(api.validDailyTile('philo', api.philoBankEntry(day)), true, day);
  const short = 'What makes a reason persuasive?';
  assert.equal(api.philoQuestionOf({theme: 'reasons', question: short}, '2026-11-03'), short);
  const long = 'If vague predicates admit borderline cases where no fact determines membership, must we reject the law of excluded middle?';
  assert.equal(api.philoQuestionOf({theme: 'vagueness', question: long}, '2026-11-03'), api.philoBankEntry('2026-11-03').question);
});

test('Brainflex puzzles are correct by construction', () => {
  for (const day of days) {
    const digits = api.makeDigits(day);
    let value = null;
    for (const step of digits.solution) {
      const [a, op, b, , result] = step.split(' ');
      assert.equal(api.applyBrainOp(Number(a), op, Number(b)), Number(result), `${day}: ${step}`);
      value = Number(result);
    }
    assert.equal(value, digits.target, day);
    const sudoku = api.makeSudoku(day);
    assert.equal(api.sudokuSolved(sudoku.solution), true, day);
    sudoku.puzzle.forEach((row, r) => row.forEach((v, c) => { if (v) assert.equal(v, sudoku.solution[r][c], day); }));
  }
  assert.ok(api.BRAIN_WORDS.every(word => /^[a-z]{5}$/.test(word)));
  assert.deepEqual(Array.from(api.scoreBrainGuess('allee', 'apple')), ['correct', 'present', 'absent', 'absent', 'correct']);
  assert.equal(new Set(days.slice(0, 3).map(api.brainGameFor)).size, 3, 'three consecutive days bring three different games');
});
