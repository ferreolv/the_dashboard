const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// World summaries end on the last fact, never on a line of empty commentary.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* NEWS_TRIM_START */'), end = html.indexOf('/* NEWS_TRIM_END */');
assert.ok(start >= 0 && end > start, 'newsSummary must be extractable');
const context = vm.createContext({});
vm.runInContext(html.slice(start, end) + ';this.newsSummary=newsSummary;', context);
const { newsSummary } = context;

test('a closing line of commentary is dropped', () => {
  assert.equal(newsSummary('EU leaders backed joint gas purchases. The move highlights the growing pressure on governments to act.'), 'EU leaders backed joint gas purchases.');
  assert.equal(newsSummary('Japan launched its first private lunar lander. This marks a significant step for its space industry.'), 'Japan launched its first private lunar lander.');
  assert.equal(newsSummary('Talks stalled in Geneva. It remains to be seen whether they resume.'), 'Talks stalled in Geneva.');
  assert.equal(newsSummary('The court blocked the law. This could have far-reaching consequences for the region.'), 'The court blocked the law.');
});

test('facts stay, including a last sentence with numbers, and one-sentence summaries', () => {
  const two = 'Brazil reported a sharp drop in deforestation. Clearing fell by a third, the lowest level since 2015.';
  assert.equal(newsSummary(two), two);
  assert.equal(newsSummary('Kenya opened a geothermal plant in the Rift Valley.'), 'Kenya opened a geothermal plant in the Rift Valley.');
  const factual = 'Paris reopened the Grand Palais. Visitors get in free this weekend.';
  assert.equal(newsSummary(factual), factual);
});
