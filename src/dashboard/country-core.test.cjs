const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Country of the day: every country once per cycle, a fair capital card, and silhouettes drawn
// from Natural Earth outlines (date line and far-off territories handled).
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* COUNTRY_CORE_START */'), end = html.indexOf('/* COUNTRY_CORE_END */');
assert.ok(start >= 0 && end > start, 'the country core must be extractable');
const ctx = vm.createContext({});
vm.runInContext(html.slice(start, end) + ';this.api={COUNTRY_LIST,COUNTRY_ORDER,countryFor,countryCapitalOptions,topoPolygons,geojsonPolygons,countryShapePath};', ctx);
const api = ctx.api;
const plain = v => JSON.parse(JSON.stringify(v));
const dayKey = n => new Date(Date.UTC(2026, 0, 1) + n * 864e5).toISOString().slice(0, 10);

test('195 countries (UN members, the Holy See, Palestine), each with a code, number, name, capital and region', () => {
  assert.equal(api.COUNTRY_LIST.length, 195);
  assert.equal(new Set(api.COUNTRY_LIST.map(r => r[0])).size, 195);
  for (const r of api.COUNTRY_LIST) assert.ok(/^[A-Z]{3}$/.test(r[0]) && /^\d{3}$/.test(r[1]) && r[2] && r[3] && ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'].includes(r[4]), JSON.stringify(r));
  const fra = api.COUNTRY_LIST.find(r => r[0] === 'FRA');
  assert.deepEqual(plain(fra), ['FRA', '250', 'France', 'Paris', 'Europe']);
});

test('every country comes once in 195 consecutive days, and the next day is a different one', () => {
  const seen = new Set();
  for (let i = 0; i < 195; i++) seen.add(api.countryFor(dayKey(i)).code);
  assert.equal(seen.size, 195);
  assert.notEqual(api.countryFor('2026-11-26').code, api.countryFor('2026-11-27').code);
  assert.equal(api.countryFor('2026-11-26').code, api.countryFor('2026-11-26').code);
});

test('the capital card offers the right capital and two others from the same region', () => {
  for (let i = 0; i < 40; i++) {
    const key = dayKey(i * 7), c = api.countryFor(key), options = plain(api.countryCapitalOptions(c, key));
    assert.equal(options.length, 3, JSON.stringify(options));
    assert.equal(new Set(options).size, 3);
    assert.ok(options.includes(c.capital));
    const regionCapitals = api.COUNTRY_LIST.filter(r => r[4] === c.region).map(r => r[3]);
    assert.ok(options.every(o => regionCapitals.includes(o)), 'decoys come from ' + c.region);
  }
});

test('a quantized TopoJSON feature decodes into rings, reversed arcs included', () => {
  const topo = { type: 'Topology', transform: { scale: [1, 1], translate: [0, 0] },
    arcs: [[[0, 0], [10, 0], [0, 10]], [[10, 10], [-10, 0], [0, -10]]],
    objects: { countries: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: '250', arcs: [[0, 1]] }, { type: 'Polygon', id: '276', arcs: [[0, ~1]] }] } } };
  assert.deepEqual(plain(api.topoPolygons(topo, '250')), [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]);
  assert.equal(plain(api.topoPolygons(topo, '276'))[0][0].length, 5);
  assert.equal(api.topoPolygons(topo, '999'), null);
});

test('the silhouette fits the 100×100 box, keeps the main body, and survives the date line', () => {
  const square = (x, y, s) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]];
  // a mainland, a nearby island, and a small territory on the other side of the world
  const d = api.countryShapePath([square(0, 40, 10), square(11, 42, 1), square(-60, 4, 1)]);
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.ok(nums.every(n => n >= 1.9 && n <= 98.1), 'inside the box');
  assert.equal((d.match(/M/g) || []).length, 2, 'the far-off territory is left out');
  // a country across the date line stays in one piece instead of spanning the whole map
  const wide = api.countryShapePath([square(175, -20, 4), square(-179, -18, 3)]);
  assert.equal((wide.match(/M/g) || []).length, 2);
  const xs = wide.match(/M([\d.]+)/g).map(m => Number(m.slice(1)));
  assert.ok(Math.max(...xs) - Math.min(...xs) < 98);
  assert.equal(api.countryShapePath([]), '');
});
