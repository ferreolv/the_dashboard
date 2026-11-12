const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The language tiles' conversation lines run in the page; extract them as written.
// Your lines (side "me") are masked until tapped, so they must carry their meaning.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('const langChatLines='), end = html.indexOf('function LangChat(');
assert.ok(start >= 0 && end > start, 'langChatLines must be extractable');
const langChatLines = vm.runInNewContext(html.slice(start, end) + ';langChatLines');
const plain = v => JSON.parse(JSON.stringify(v));

test('a dialogue alternates speaker and you, four lines at most', () => {
  const d = [1, 2, 3, 4, 5].map(n => ({ text: 'l' + n, sub: 't' + n }));
  const lines = plain(langChatLines(d, 'point', [{ text: 'w', sub: 'm' }]));
  assert.deepEqual(lines.map(l => l.side), ['them', 'me', 'them', 'me']);
  assert.deepEqual(lines.map(l => l.text), ['l1', 'l2', 'l3', 'l4']);
  assert.ok(lines.every(l => l.sub), 'every line keeps its translation');
});

test('without a dialogue the flag gives the point and the words are yours, pronunciation kept for after', () => {
  const lines = plain(langChatLines(undefined, 'Le verbe en 2e position.', [{ text: 'der Kaffee', sub: 'le café', after: 'dèr kafé' }, { text: 'bitte', sub: "s'il vous plaît" }]));
  assert.deepEqual(lines.map(l => l.side), ['them', 'me', 'me']);
  assert.equal(lines[1].sub, 'le café', 'the pronunciation would give the word away, so it is not in the prompt');
  assert.equal(lines[1].after, 'dèr kafé');
  assert.equal(lines[2].after, '');
});

test('a one-line or empty dialogue falls back to the point and words', () => {
  assert.deepEqual(plain(langChatLines([{ text: 'solo', sub: 's' }], 'p', [])).map(l => l.text), ['p']);
  assert.deepEqual(plain(langChatLines([], '', [{ text: 'w', sub: 'm' }])).map(l => l.side), ['me']);
});

test('the chat says whether it is a dialogue, so the pop-up repeats nothing it already showed', () => {
  assert.equal(langChatLines([{ text: 'a', sub: 'x' }, { text: 'b', sub: 'y' }], 'p', []).dialogue, true);
  assert.equal(langChatLines([], 'p', [{ text: 'w', sub: 'm' }]).dialogue, undefined);
});
