const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Art: the same public-domain work with an image for everyone on a given day, from the free
// Art Institute of Chicago API, whichever form of its search query the API honours.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* ART_DAY_START */'), end = html.indexOf('/* ART_DAY_END */');
assert.ok(start >= 0 && end > start, 'the art helpers must be extractable');
const context = vm.createContext({ fetch: () => { throw new Error('no network in tests'); } });
vm.runInContext(html.slice(start, end) + ';this.api={fetchArtOfDay,artFromHit,artHash,artDayNumber,ART_SEARCHES};', context);
const { fetchArtOfDay, artFromHit } = context.api;
const plain = v => JSON.parse(JSON.stringify(v));

const hit = n => ({ id: n, title: `Work ${n}`, artist_title: 'Claude Monet', artist_display: 'Claude Monet\nFrench, 1840–1926', date_display: '1906', image_id: `img-${n}`,
  thumbnail: { width: 3000, height: 2000, lqip: 'data:image/gif;base64,R0lGOD', alt_text: 'A pond' }, medium_display: 'Oil on canvas', place_of_origin: 'France',
  short_description: '<p>Monet painted his pond <em>again and again</em>. He did so for decades. Late works blur. A fourth sentence.</p>', dimensions: '89.9 × 94.1 cm (35 3/8 × 37 1/16 in.)\nFramed: …', is_public_domain: true });
const museum = (total, pick = n => hit(n)) => url => {
  const page = Number(new URL(url).searchParams.get('page'));
  return Promise.resolve({ pagination: { total }, data: [pick(page)], config: { iiif_url: 'https://www.artic.edu/iiif/2' } });
};

test('a hit becomes a framed work: image sizes, label, a short note, the museum page', () => {
  const art = plain(artFromHit(hit(7), { iiif_url: 'https://www.artic.edu/iiif/2' }));
  assert.equal(art.image, 'https://www.artic.edu/iiif/2/img-7/full/843,/0/default.jpg');
  assert.equal(art.imageLarge, 'https://www.artic.edu/iiif/2/img-7/full/1686,/0/default.jpg');
  assert.equal(art.artist, 'Claude Monet');
  assert.equal(art.artistLine, 'Claude Monet · French, 1840–1926');
  assert.equal(art.ratio, 1.5);
  assert.equal(art.about, 'Monet painted his pond again and again. He did so for decades. Late works blur.');
  assert.equal(art.dimensions, '89.9 × 94.1 cm (35 3/8 × 37 1/16 in.)');
  assert.equal(art.url, 'https://www.artic.edu/artworks/7');
  assert.equal(artFromHit({ ...hit(1), image_id: null }), null, 'no image, no work');
  assert.equal(artFromHit({ ...hit(1), is_public_domain: false }), null, 'only public domain');
});

test('every device gets the same work for a day, and the day changes the work', async () => {
  const a = await fetchArtOfDay('2026-11-25', museum(800));
  const b = await fetchArtOfDay('2026-11-25', museum(800));
  const c = await fetchArtOfDay('2026-11-26', museum(800));
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.ok(a.id >= 1 && a.id <= 800);
});

test('the page asked for never passes the first thousand results', async () => {
  const pages = [];
  await fetchArtOfDay('2026-11-25', url => { pages.push(Number(new URL(url).searchParams.get('page'))); return museum(120000)(url); });
  assert.ok(pages.every(p => p >= 1 && p <= 1000), JSON.stringify(pages));
});

test('when a search form is not honoured (non public-domain hits) or fails, the next form is used', async () => {
  const urls = [];
  const get = url => {
    urls.push(url);
    if (url.includes('params=')) return Promise.resolve({ pagination: { total: 130000 }, data: [{ ...hit(3), is_public_domain: false }] });
    if (url.includes('query[bool]')) return Promise.reject(new Error('400'));
    return museum(50)(url);
  };
  const art = await fetchArtOfDay('2026-11-25', get);
  assert.ok(art && art.image.includes('img-'));
  assert.ok(urls.some(u => u.includes('query[term][is_public_domain]=true')), 'fell back to the plainest form');
});

test('nothing reachable gives nothing, not an error', async () => {
  assert.equal(await fetchArtOfDay('2026-11-25', () => Promise.reject(new Error('offline'))), null);
});
