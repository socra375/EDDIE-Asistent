// «Cannot set property message of … which has only a getter»: a DOMException (the timeout of a fetch) cannot have its message
// rewritten, and the attempt hid the real failure of the backup provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { withMessage } = await import(`${root}/api/_lib/errorMessage.js`);

test('the bug itself: assigning to a DOMException message throws', () => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  assert.throws(() => { 'use strict'; timeout.message = 'x'; }, /only a getter/);
});

test('an ordinary error gets the new message and stays the same object', () => {
  const err = Object.assign(new Error('antes'), { code: 'PROVIDER_ERROR', status: 502 });
  const out = withMessage(err, 'después');
  assert.equal(out, err);
  assert.equal(out.message, 'después');
  assert.equal(out.code, 'PROVIDER_ERROR');
});

test('a timeout (DOMException) becomes a plain Error with the message, the cause and an «unavailable» code', () => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const out = withMessage(timeout, 'Gemini falló (El respaldo Groq también falló: The operation was aborted due to timeout)');
  assert.ok(out instanceof Error);
  assert.match(out.message, /El respaldo Groq también falló: The operation was aborted due to timeout/);
  assert.equal(out.cause, timeout);
  assert.equal(out.code, 'PROVIDER_UNAVAILABLE');
});

test('frozen errors and things that are not errors are handled too', () => {
  const frozen = Object.freeze(Object.assign(new Error('x'), { code: 'PROVIDER_ERROR' }));
  const out = withMessage(frozen, 'y');
  assert.equal(out.message, 'y');
  assert.equal(out.code, 'PROVIDER_ERROR');
  assert.equal(withMessage(undefined, 'solo texto').message, 'solo texto');
  assert.equal(withMessage('un texto', 'otro').message, 'otro');
});

test('callProvider: when the backup provider times out too, the user reads both failures (not the TypeError)', async () => {
  process.env.GEMINI_API_KEY = 'k1';
  process.env.GROQ_API_KEY = 'k2';
  delete process.env.ANTHROPIC_API_KEY;
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes('generativelanguage.googleapis.com')) return new Response(JSON.stringify({ error: { code: 500, message: 'Gemini roto', status: 'INTERNAL' } }), { status: 500, headers: { 'content-type': 'application/json' } });
    // the backup answers, then its stream goes silent and the idle timeout aborts it: reading rejects with a DOMException
    const body = new ReadableStream({ pull(c) { c.error(new DOMException('Tiempo de espera agotado.', 'TimeoutError')); } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const { callProvider } = await import(`${root}/api/_lib/providers.js`);
    await assert.rejects(
      () => callProvider({ provider: 'gemini', messages: [{ role: 'user', content: 'hola' }], system: 'x' }),
      (err) => {
        assert.doesNotMatch(err.message, /only a getter/);
        assert.match(err.message, /El respaldo .* también falló/);
        return true;
      },
    );
    assert.ok(calls >= 2, 'the backup was really tried');
  } finally {
    globalThis.fetch = real;
  }
});
