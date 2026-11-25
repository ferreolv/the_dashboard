const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Language flashcards ask for the word in context and never over-explain.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* LANG_CARD_START */'), end = html.indexOf('/* LANG_CARD_END */');
assert.ok(start >= 0 && end > start, 'the language card helpers must be extractable');
const context = vm.createContext({});
vm.runInContext(html.slice(start, end) + ';this.api={langTerseExplain,langVocabPrompt};', context);
const { langTerseExplain, langVocabPrompt } = context.api;

test('a vocab card blanks the word in the day\'s dialogue line, with its meaning as the hint', () => {
  const dialogo = [{ es: 'Estas manzanas son muy baratas hoy.', en: '' }, { es: '¿Cuánto cuesta el kilo de fresas?', en: '' }];
  assert.equal(langVocabPrompt('cuesta', 'costs', dialogo), '¿Cuánto ___ el kilo de fresas? (costs)');
  assert.equal(langVocabPrompt('Cuánto', 'how much', dialogo), '¿___ cuesta el kilo de fresas? (how much)', 'accents and case do not shift the blank');
  assert.equal(langVocabPrompt('el puesto', 'the stall', dialogo), '¿Cómo se dice “the stall”?', 'no line: ask for the Spanish');
});

test('explanations are one short line, or nothing when they only restate the answer', () => {
  assert.equal(langTerseExplain('“barato” = cheap.', 'cheap'), '');
  assert.equal(langTerseExplain('« die Rechnung » = l\'addition (prononcé di RÈ-chnoung).', "l'addition"), '');
  assert.equal(langTerseExplain('Fui.', 'fui'), '');
  assert.equal(langTerseExplain('Pretérito: la acción terminó ayer. Además, el verbo ir es irregular y se conjuga así en todas las personas.', 'fui'), 'Pretérito: la acción terminó ayer.');
  assert.equal(langTerseExplain('', 'x'), '');
});
