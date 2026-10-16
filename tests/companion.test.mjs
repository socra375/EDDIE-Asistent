// Eddie te acompaña mientras trabaja: las frases, el ritmo y que no se repitan.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const C = await import(`${root}/src/services/companion.js`);

test('every line is short enough to be said in a few seconds, and there are no duplicates', () => {
  assert.ok(C.ALL_LINES.length >= 40);
  assert.equal(new Set(C.ALL_LINES).size, C.ALL_LINES.length, 'no line twice');
  for (const line of C.ALL_LINES) assert.ok(line.length <= 125, `${line.length}: ${line}`);
  for (const line of C.ALL_LINES) assert.match(line, /[.?)»]$/, line);
});

test('the rhythm: a first wait, then regular, a little slower each time, and a ceiling', () => {
  assert.equal(C.delayFor(0), C.FIRST_MS);
  assert.ok(C.delayFor(1) >= C.EVERY_MS);
  assert.ok(C.delayFor(3) > C.delayFor(1));
  assert.equal(C.delayFor(9), C.delayFor(20), 'it stops growing');
  assert.ok(C.MAX_LINES <= 10, 'never a monologue');
});

test('the first line is about what he is doing when he has something for it', () => {
  const mail = C.pickLine({ context: 'Revisando tu correo…', count: 0, rand: () => 0 });
  assert.equal(mail.kind, 'tema');
  assert.match(mail.text, /correo/i);
  const agenda = C.pickLine({ context: 'Mirando tu agenda de Google Calendar…', count: 0, rand: () => 0 });
  assert.match(agenda.text, /agenda/i);
  const video = C.pickLine({ context: 'Editando el video con ffmpeg', count: 0, rand: () => 0 });
  assert.match(video.text, /video/i);
});

test('with nothing to say about it, or on odd turns, it is a joke, a fact or a tip in turn', () => {
  assert.equal(C.pickLine({ context: '', count: 0, rand: () => 0 }).kind, 'broma');
  assert.equal(C.pickLine({ context: 'Pensando…', count: 1, rand: () => 0 }).kind, 'dato');
  assert.equal(C.pickLine({ context: 'Pensando…', count: 2, rand: () => 0 }).kind, 'consejo');
  assert.equal(C.pickLine({ context: 'Revisando tu correo…', count: 1, rand: () => 0 }).kind, 'dato', 'odd turn: not about the topic');
});

test('a line is never repeated within a request, and it runs out gracefully', () => {
  const used = new Set();
  let count = 0;
  for (; count < 200; count += 1) {
    const line = C.pickLine({ context: 'buscando en internet', used, count });
    if (!line) break;
    assert.ok(!used.has(line.text), `repeated: ${line.text}`);
    used.add(line.text);
  }
  assert.ok(used.size >= C.JOKES.length + C.FACTS.length + C.TIPS.length, 'it used the whole general pool before running out');
  assert.equal(C.pickLine({ context: '', used: new Set(C.ALL_LINES), count: 0 }), null);
});

test('a topical line is not used when it was already said (it falls back to the general pool)', () => {
  const used = new Set(C.TOPICAL.find((t) => t.topic === 'correo').lines);
  const line = C.pickLine({ context: 'correo', used, count: 0, rand: () => 0 });
  assert.notEqual(line.kind, 'tema');
});

test('bad input does not break it', () => {
  assert.ok(C.pickLine({ context: null, used: undefined, count: undefined }));
  assert.ok(C.pickLine({ context: 12345, count: 3 }));
});
