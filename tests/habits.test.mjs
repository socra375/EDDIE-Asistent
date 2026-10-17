// Hábitos de YouTube: lo que la extensión lee del historial (solo YouTube, con permiso), cómo se convierte en una oferta
// («¿Quieres que reproduzca X?») y cuándo Eddie NO debe ofrecer nada.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { installNeon } from './helpers/fakeneon.mjs';

process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
process.env.CONNECTOR_SECRET = 'a'.repeat(40);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const H = await import(`${root}/extension/history.js`);
const P = await import(`${root}/api/_lib/habits/profile.js`);
const S = await import(`${root}/api/_lib/habits/store.js`);
const t = (name, fn) => test(name, fn);

// ---------------- extension: what is read ----------------
t('only YouTube watch pages are recognised, with their video id', () => {
  assert.deepEqual(H.watchOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s'), { id: 'dQw4w9WgXcQ', music: false });
  assert.deepEqual(H.watchOf('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', music: true });
  assert.deepEqual(H.watchOf('https://youtu.be/dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', music: false });
  for (const no of ['https://www.youtube.com/feed/history', 'https://www.youtube.com/results?search_query=x', 'https://youtube.com.evil.co/watch?v=dQw4w9WgXcQ', 'https://bank.example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=corto', 'javascript:alert(1)', '', null]) {
    assert.equal(H.watchOf(no), null, String(no));
  }
});

t('titles lose the YouTube suffix and the unread counter', () => {
  assert.equal(H.cleanTitle('(3) Bad Bunny - Tití Me Preguntó - YouTube'), 'Bad Bunny - Tití Me Preguntó');
  assert.equal(H.cleanTitle('Salsa mix - YouTube Music'), 'Salsa mix');
});

t('collecting reads the history through the browser and keeps only YouTube videos, grouped', async () => {
  const now = 1_800_000_000_000;
  const day = 86400000;
  const entries = {
    'https://www.youtube.com/watch?v=aaaaaaaaaaa': { title: 'Canción A - YouTube', visits: [now - day, now - 2 * day] },
    'https://www.youtube.com/watch?v=aaaaaaaaaaa&t=10': { title: 'Canción A - YouTube', visits: [now - 3 * day] },
    'https://www.youtube.com/watch?v=bbbbbbbbbbb': { title: 'Canción B - YouTube', visits: [now - 100 * day] }, // too old
    'https://mail.google.com/mail/u/0/': { title: 'Gmail', visits: [now - day] },
  };
  const asked = [];
  const history = {
    search: async (q) => {
      asked.push(q);
      return Object.entries(entries).map(([url, e]) => ({ url, title: e.title }));
    },
    getVisits: async ({ url }) => entries[url].visits.map((visitTime) => ({ visitTime })),
  };
  const items = await H.collectYoutube(history, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'aaaaaaaaaaa');
  assert.equal(items[0].visits.length, 3);
  assert.equal(asked[0].text, 'youtu');
  // the visits go as seconds
  assert.ok(items[0].visits.every((v) => v < 2_000_000_000));
});

// ---------------- server: cleaning what arrives ----------------
t('the server keeps only well-formed videos and visits', () => {
  const now = Math.round(Date.now() / 1000);
  const items = S.cleanItems([
    { id: 'aaaaaaaaaaa', title: '  Canción   A ', music: true, visits: [now - 100, now - 50, 5, 'x', now + 99999] },
    { id: 'no', title: 'x', visits: [now] },
    { id: 'bbbbbbbbbbb', title: '', visits: [now] },
    { id: 'ccccccccccc', title: 'Sin visitas', visits: [] },
    null,
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { id: 'aaaaaaaaaaa', title: 'Canción A', music: true, visits: [now - 100, now - 50] });
  assert.deepEqual(S.cleanItems('nope'), []);
});

// ---------------- profile: when it is the moment ----------------
const TZ = 'America/Santo_Domingo'; // UTC-4, no daylight saving
const at = (iso) => Date.parse(iso) / 1000;
const NOW = at('2026-10-14T22:00:00Z'); // Wednesday 18:00 local

function listensAround(id, title, hourLocal, days, music = true) {
  // `days` days back, each at the given local hour (UTC-4)
  const visits = days.map((d) => NOW - d * 86400 + (hourLocal - 18) * 3600);
  return { id, title, music, visits: visits.sort((a, b) => a - b) };
}

t('the local time slot follows the user\'s time zone', () => {
  assert.deepEqual(P.localSlot(at('2026-10-14T22:30:00Z'), TZ), { dow: 3, minutes: 18 * 60 + 30 });
  assert.deepEqual(P.localSlot(at('2026-10-15T02:00:00Z'), TZ), { dow: 3, minutes: 22 * 60 });
});

t('a song heard at this hour on past days is offered; one heard at another hour is not', () => {
  const items = [listensAround('aaaaaaaaaaa', 'Salsa de la tarde', 18, [1, 2, 3, 5]), listensAround('bbbbbbbbbbb', 'Música para dormir', 23, [1, 2, 3, 4, 5, 6])];
  const pick = P.pickOffer(items, { timezone: TZ, now: NOW });
  assert.equal(pick.videoId, 'aaaaaaaaaaa');
  assert.match(P.offerText(pick.title), /^¿Quieres que reproduzca «Salsa de la tarde»\?/);
});

t('nothing is offered for a song heard once, or with nothing near this hour', () => {
  assert.equal(P.pickOffer([listensAround('aaaaaaaaaaa', 'Una vez', 18, [1])], { timezone: TZ, now: NOW }), null);
  assert.equal(P.pickOffer([listensAround('aaaaaaaaaaa', 'De madrugada', 3, [1, 2, 3, 4])], { timezone: TZ, now: NOW }), null);
  assert.equal(P.pickOffer([], { timezone: TZ, now: NOW }), null);
});

t('no offers at night, too soon after another, past the daily limit, or for a song just declined', () => {
  const items = [listensAround('aaaaaaaaaaa', 'Salsa', 18, [1, 2, 3, 5])];
  const base = { timezone: TZ, now: NOW };
  assert.ok(P.pickOffer(items, base));
  // too soon: another offer two hours ago
  assert.equal(P.pickOffer(items, { ...base, offers: [{ videoId: 'zzzzzzzzzzz', offeredAt: NOW - 2 * 3600, outcome: 'accepted' }] }), null);
  // declined four days ago: quiet for a week; declined ten days ago: back
  assert.equal(P.pickOffer(items, { ...base, offers: [{ videoId: 'aaaaaaaaaaa', offeredAt: NOW - 4 * 86400, outcome: 'declined' }] }), null);
  assert.ok(P.pickOffer(items, { ...base, offers: [{ videoId: 'aaaaaaaaaaa', offeredAt: NOW - 10 * 86400, outcome: 'declined' }] }));
  // three already today (the earlier ones, more than three hours apart)
  const offers = [4, 8, 12].map((h) => ({ videoId: 'q'.repeat(11), offeredAt: NOW - h * 3600, outcome: 'declined' }));
  const today = P.pickOffer(items, { ...base, now: NOW, offers: offers.filter((o) => P.localSlot(o.offeredAt, TZ).dow === 3) });
  assert.equal(today, null);
  // night: 23:30 local
  assert.equal(P.pickOffer([listensAround('aaaaaaaaaaa', 'Salsa', 23, [1, 2, 3, 5])], { timezone: TZ, now: NOW + 5.5 * 3600 }), null);
});

t('the weekday habit counts more than the weekend one', () => {
  // NOW is a Wednesday. Past visits: 4 on weekdays vs the same hour on weekend days.
  const weekday = listensAround('aaaaaaaaaaa', 'Entre semana', 18, [1, 2, 6, 7]); // Tue, Mon, Thu(-6d=Thu 8th)... all weekdays
  const weekend = listensAround('bbbbbbbbbbb', 'Fin de semana', 18, [3, 4, 10, 11]); // Sun 11, Sat 10, Sun 4th, Sat 3rd
  assert.ok(P.scoreAt(weekday, NOW, TZ) > P.scoreAt(weekend, NOW, TZ));
});

t('the summary lists favourites, the peak hours and what fits now', () => {
  const items = [listensAround('aaaaaaaaaaa', 'Salsa de la tarde', 18, [1, 2, 3, 5]), listensAround('bbbbbbbbbbb', 'Rock', 9, [1, 2])];
  const sum = P.summarize(items, { timezone: TZ, now: NOW });
  assert.equal(sum.videos, 2);
  assert.equal(sum.favourites[0].title, 'Salsa de la tarde');
  assert.equal(sum.peakHours[0], '18:00');
  assert.deepEqual(sum.nowFits, ['Salsa de la tarde']);
});

// ---------------- the routes ----------------
const { handleHabitsRoute } = await import(`${root}/api/_lib/habits/handlers.js`);
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.c', name: 'A', avatar_url: null };
const OFFER_ID = '22222222-2222-4222-8222-222222222222';
const route = (sub, body, method = 'POST') => handleHabitsRoute({ method, path: sub ? ['habits', sub] : ['habits'], cookies: { eddie_session: 's' }, body });

function fakeHabits({ settings = {}, items = [] } = {}) {
  const state = { history: items.length ? { items: JSON.stringify(items), synced_at: new Date().toISOString() } : null, offers: [], cleared: 0 };
  const handlers = [
    [/^select u\.id, u\.email.* from sessions s join users u/, () => [{ ...USER, expires_at: new Date(Date.now() + 86400000).toISOString() }]],
    [/select data from settings/, () => [{ data: settings }]],
    [/select items, synced_at from youtube_history/, () => (state.history ? [state.history] : [])],
    [/insert into youtube_history/, (p) => { state.history = { items: p[1], synced_at: new Date().toISOString() }; return []; }],
    [/delete from youtube_history/, () => { state.cleared += 1; state.history = null; return []; }],
    [/delete from music_offers/, () => { state.offers.length = 0; return []; }],
    [/from music_offers where user_id/, () => state.offers.map((o) => ({ video_id: o.video_id, offered_at: o.offered_at, outcome: o.outcome }))],
    [/insert into music_offers/, (p) => { state.offers.push({ id: OFFER_ID, video_id: p[1], offered_at: new Date().toISOString(), outcome: null }); return [{ id: OFFER_ID }]; }],
    [/update music_offers set outcome/, (p) => {
      const o = state.offers.find((x) => x.id === p[1] && x.outcome === null);
      if (!o) return [];
      o.outcome = p[0];
      return [{ video_id: o.video_id, title: 'Salsa de la tarde' }];
    }],
  ];
  return { state, handlers };
}

// The routes read the clock: it is fixed at Wednesday 18:00 in the user's zone for these tests.
const realNow = NOW;
const around = (id, title, days) => ({ id, title, music: true, visits: days.map((d) => NOW - d * 86400).sort((a, b) => a - b) });
const clock = () => mock.timers.enable({ apis: ['Date'], now: NOW * 1000 });

t('suggest offers a song once, then waits; the answer closes it and an accepted song counts as one more listen', async () => {
  const items = [around('aaaaaaaaaaa', 'Salsa de la tarde', [1, 2, 3, 5])];
  const db = fakeHabits({ items });
  const restore = installNeon(db.handlers);
  clock();
  try {
    const first = await route('suggest', { tz: TZ });
    assert.equal(first.json.offer.videoId, 'aaaaaaaaaaa');
    assert.match(first.json.offer.text, /^¿Quieres que reproduzca/);
    // asking again right away: no second offer
    assert.equal((await route('suggest', { tz: TZ })).json.offer, null);
    assert.equal((await route('answer', { id: OFFER_ID, outcome: 'accepted' })).status, 200);
    assert.equal(JSON.parse(db.state.history.items)[0].visits.length, 5);
    // answered once only
    await route('answer', { id: OFFER_ID, outcome: 'accepted' });
    assert.equal(JSON.parse(db.state.history.items)[0].visits.length, 5);
    assert.equal((await route('answer', { id: 'nope', outcome: 'accepted' })).status, 400);
  } finally {
    mock.timers.reset();
    restore();
  }
});

t('with the setting off, or no history, nothing is offered', async () => {
  const off = fakeHabits({ settings: { musicOffers: false }, items: [around('aaaaaaaaaaa', 'Salsa', [1, 2, 3])] });
  let restore = installNeon(off.handlers);
  try {
    assert.equal((await route('suggest', { tz: TZ })).json.offer, null);
    assert.equal(off.state.offers.length, 0);
  } finally {
    restore();
  }
  const empty = fakeHabits();
  restore = installNeon(empty.handlers);
  try {
    assert.equal((await route('suggest', { tz: TZ })).json.offer, null);
    assert.equal((await route(undefined, undefined, 'GET')).json.count, 0);
  } finally {
    restore();
  }
});

t('the history is forgotten on request: the copy and the offers', async () => {
  const db = fakeHabits({ items: [around('aaaaaaaaaaa', 'Salsa', [1, 2, 3])] });
  const restore = installNeon(db.handlers);
  try {
    assert.equal((await route(undefined, undefined, 'GET')).json.count, 1);
    assert.equal((await route('clear', {})).status, 200);
    assert.equal(db.state.history, null);
    assert.equal((await route(undefined, undefined, 'GET')).json.count, 0);
  } finally {
    restore();
  }
});

t('the extension route stores a cleaned copy and can clear it', async () => {
  const { handleBrowserRoute } = await import(`${root}/api/_lib/browser/handlers.js`);
  const db = fakeHabits();
  const TOKEN = 't'.repeat(40);
  const restore = installNeon([
    [/update browser_links set last_seen_at = now\(\) where token_hash/, () => [{ user_id: USER.id, name: 'Chrome', version: '1.7.0', last_seen_at: new Date().toISOString(), auto_meetings: true, lead_minutes: 1, open_created: true }]],
    ...db.handlers,
  ]);
  try {
    const ok = await handleBrowserRoute({
      method: 'POST', path: ['browser', 'agent', 'history'], headers: { authorization: `Bearer ${TOKEN}` }, cookies: {},
      body: { items: [{ id: 'aaaaaaaaaaa', title: 'Salsa - YouTube', music: true, visits: [realNow - 3600] }, { id: 'mal', title: 'x', visits: [realNow] }] },
    });
    assert.equal(ok.status, 200);
    const saved = JSON.parse(db.state.history.items);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, 'aaaaaaaaaaa');
    const cleared = await handleBrowserRoute({ method: 'POST', path: ['browser', 'agent', 'history'], headers: { authorization: `Bearer ${TOKEN}` }, cookies: {}, body: { clear: true } });
    assert.equal(cleared.status, 200);
    assert.equal(db.state.history, null);
  } finally {
    restore();
  }
});
