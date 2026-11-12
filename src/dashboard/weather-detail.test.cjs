const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The Weather pop-up's forecast helpers and the fetch run in the page; extract them as written.
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('/* WEATHER_DETAIL_START */'), end = html.indexOf('/* iCloud / vCard');
assert.ok(start >= 0 && end > start, 'weather helpers and fetch must be extractable');
const calls = [];
let replies = [];
const ctx = {
  AbortSignal, calls,
  getLocationProfile: () => ({ name: 'London', latitude: 51.5, longitude: -0.13, timezone: 'Europe/London' }),
  fetch: async url => { calls.push(url); const r = replies.shift(); return { ok: r.ok, json: async () => r.body }; }
};
vm.createContext(ctx);
vm.runInContext(html.slice(start, end) + ';Object.assign(globalThis,{weatherDetail,wxHourly,wxClock,wxHourLabel,wxCompass,wxUvLabel,wxTempColor,fetchWeather});', ctx);
const plain = v => JSON.parse(JSON.stringify(v));

const day = '2026-11-10', next = '2026-11-11';
const hourly = { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [], is_day: [] };
for (let i = 0; i < 72; i++) {
  const d = i < 24 ? day : i < 48 ? next : '2026-11-12', h = String(i % 24).padStart(2, '0');
  hourly.time.push(`${d}T${h}:00`); hourly.temperature_2m.push(8 + (i % 24) / 3); hourly.weather_code.push(i % 24 < 12 ? 2 : 61);
  hourly.precipitation_probability.push(i % 24 < 12 ? 5 : 60); hourly.is_day.push(i % 24 >= 7 && i % 24 < 17 ? 1 : 0);
}
const full = {
  current: { time: `${day}T14:15`, temperature_2m: 12.6, apparent_temperature: 10.2, relative_humidity_2m: 81, weather_code: 3, is_day: 1, wind_speed_10m: 17.4, wind_direction_10m: 230, wind_gusts_10m: 31.9, precipitation: 0, pressure_msl: 1012.4, visibility: 24140, uv_index: 1.2 },
  hourly,
  daily: { time: [day, next, '2026-11-12'], weather_code: [3, 61, 2], temperature_2m_max: [14.2, 11.6, 9.4], temperature_2m_min: [7.8, 6.1, 3.9], sunrise: [`${day}T07:12`, `${next}T07:14`, '2026-11-12T07:16'], sunset: [`${day}T16:14`, `${next}T16:12`, '2026-11-12T16:11'], precipitation_probability_max: [35, 80, 10], precipitation_sum: [1.24, 6.8, 0], uv_index_max: [1.4, 0.9, 1.6], wind_speed_10m_max: [22, 30, 14] }
};

test('the forecast is read into rounded current details, 48 hours and the days', () => {
  const d = plain(ctx.weatherDetail(full));
  assert.deepEqual([d.now.feels, d.now.humidity, d.now.wind, d.now.gusts, d.now.windDir, d.now.pressure], [10, 81, 17, 32, 230, 1012]);
  assert.equal(d.hours.length, 48);
  assert.deepEqual(d.hours[0], { t: `${day}T00:00`, temp: 8, code: 2, pop: 5, day: false });
  assert.deepEqual(d.days.map(x => [x.date, x.lo, x.hi, x.pop]), [[day, 8, 14, 35], [next, 6, 12, 80], ['2026-11-12', 4, 9, 10]]);
  assert.equal(d.days[0].sunset, `${day}T16:14`);
});

test('a reply without the extra blocks gives empty details, never an error', () => {
  const d = plain(ctx.weatherDetail({ current: { temperature_2m: 10, weather_code: 1 }, daily: { temperature_2m_max: [12], temperature_2m_min: [5], weather_code: [1] } }));
  assert.deepEqual(d.hours, []);
  assert.deepEqual(d.days, []);
  assert.equal(d.now.feels, null);
});

test('the strip covers the coming day in two-hour steps, with both the sunset and the next sunrise', () => {
  const data = { temp: 13, code: 3, ...plain(ctx.weatherDetail(full)) };
  const items = plain(ctx.wxHourly(data, `${day}T14:40`));
  const hours = items.filter(i => i.kind === 'hour');
  assert.equal(items[0].label, 'Now');
  assert.equal(items[0].temp, 13, 'the live reading is from this hour');
  assert.equal(hours.length, 12, 'twelve stops: 24 hours');
  assert.deepEqual(hours.slice(0, 4).map(h => h.t.slice(11, 13)), ['14', '16', '18', '20'], 'every two hours');
  const sunset = items.find(i => i.kind === 'sunset'), sunrise = items.find(i => i.kind === 'sunrise');
  assert.ok(sunset && sunrise, 'both sun events are in a 24-hour strip');
  assert.equal(sunset.label, '4:14PM');
  assert.equal(sunrise.label, '7:14AM');
  assert.equal(items[items.indexOf(sunset) - 1].t, `${day}T16:00`, 'the sunset sits right after the 4PM stop');
  assert.equal(items[items.indexOf(sunrise) - 1].t, `${next}T06:00`, 'the sunrise sits right after the 6AM stop');
  assert.ok(!items.some(i => i.kind === 'sunrise' && i.t <= `${day}T14:40`), "today's sunrise, already passed, is left out");
  const late = plain(ctx.wxHourly(data, `${day}T22:10`));
  assert.ok(late.find(i => i.kind === 'sunrise') && late.find(i => i.kind === 'sunset'), 'late at night both are still there');
});

test('an older snapshot uses the forecast for now, not the stale reading', () => {
  const data = { temp: 9, code: 1, ...plain(ctx.weatherDetail(full)) };
  const items = plain(ctx.wxHourly(data, `${day}T19:05`, 6));
  assert.equal(items[0].label, 'Now');
  assert.equal(items[0].temp, Math.round(8 + 19 / 3));
});

test('labels read like a forecast app', () => {
  assert.equal(ctx.wxHourLabel(`${day}T00:00`), '12AM');
  assert.equal(ctx.wxHourLabel(`${day}T12:00`), '12PM');
  assert.equal(ctx.wxHourLabel(`${day}T19:00`), '7PM');
  assert.equal(ctx.wxClock(`${day}T07:05`), '7:05AM');
  assert.equal(ctx.wxCompass(230), 'SW');
  assert.equal(ctx.wxCompass(359), 'N');
  assert.equal(ctx.wxUvLabel(1.4), 'Low');
  assert.equal(ctx.wxUvLabel(6), 'High');
  assert.match(ctx.wxTempColor(30), /^rgb\(255,69,58\)$/);
  assert.match(ctx.wxTempColor(-20), /^rgb\(110,139,255\)$/);
});

test('fetchWeather asks for the detailed free forecast and keeps the tile basics', async () => {
  calls.length = 0; replies = [{ ok: true, body: full }];
  const w = plain(await ctx.fetchWeather());
  assert.equal(calls.length, 1);
  assert.match(calls[0], /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(calls[0], /hourly=temperature_2m/);
  assert.match(calls[0], /forecast_days=7/);
  assert.deepEqual([w.temp, w.hi, w.lo, w.tomorrow.hi, w.tomorrow.lo, w.place], [13, 14, 8, 12, 6, 'London']);
  assert.equal(w.hours.length, 48);
});

test('if the detailed request is refused, the basic one still fills the tile', async () => {
  calls.length = 0;
  replies = [{ ok: false, body: { error: true } }, { ok: true, body: { current: { temperature_2m: 11, weather_code: 2 }, daily: { temperature_2m_max: [13, 12], temperature_2m_min: [6, 5], weather_code: [2, 3] } } }];
  const w = plain(await ctx.fetchWeather());
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1], /hourly=/);
  assert.deepEqual([w.temp, w.hi, w.lo, w.tomorrow.code], [11, 13, 6, 3]);
  assert.deepEqual(w.hours, []);
});
