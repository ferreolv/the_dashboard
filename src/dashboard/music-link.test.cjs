const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The record on the Music tile must open the song in the Music app, above all on a phone.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* MUSIC_LINK_START */'), end = html.indexOf('/* MUSIC_LINK_END */');
assert.ok(start >= 0 && end > start, 'the music link helpers must be extractable');
const load = ua => {
  const context = vm.createContext({ navigator: ua, musicPrimaryArtist: a => String(a || '').trim() });
  vm.runInContext(html.slice(start, end) + ';this.api={musicAppHref,appleMusicUrl,OPENS_MUSIC_APP};', context);
  return context.api;
};
const SONG = 'https://music.apple.com/fr/album/clair-de-lune/1440818839?i=1440819092&uo=4';

test('on an iPhone the record opens the Music app itself, not a browser page', () => {
  const api = load({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 });
  assert.equal(api.OPENS_MUSIC_APP, true);
  assert.equal(api.musicAppHref(SONG), 'music://music.apple.com/fr/album/clair-de-lune/1440818839?i=1440819092');
});

test('on an iPad and a Mac too; old geo links are cleaned', () => {
  const ipad = load({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 });
  const mac = load({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 });
  assert.equal(ipad.OPENS_MUSIC_APP, true);
  assert.equal(mac.OPENS_MUSIC_APP, true);
  assert.equal(mac.musicAppHref('https://geo.music.apple.com/fr/album/x/1?i=2'), 'music://music.apple.com/fr/album/x/1?i=2');
});

test('elsewhere the link stays a plain https catalog link that keeps the song id', () => {
  const android = load({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', platform: 'Linux armv8l', maxTouchPoints: 5 });
  assert.equal(android.OPENS_MUSIC_APP, false);
  assert.equal(android.musicAppHref(SONG), 'https://music.apple.com/fr/album/clair-de-lune/1440818839?i=1440819092');
  assert.equal(android.appleMusicUrl('https://music.apple.com/fr/artist/claude-debussy/4374?uo=4'), 'https://music.apple.com/fr/artist/claude-debussy/4374');
});
