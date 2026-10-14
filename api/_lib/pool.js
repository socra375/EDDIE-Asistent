// Runs `fn` over `items` with at most `limit` at a time, so several jobs due at the
// same minute run together instead of one after another. Nothing new is started
// once `deadline` (a Date.now() value) has passed: what was left waits for the next
// tick, which is better than a serverless function being cut off half-way.
// Never throws: a job that fails is logged and the others carry on.
export async function mapLimit(items, limit, fn, { deadline = Infinity } = {}) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && Date.now() < deadline) {
      const item = items[next];
      next += 1;
      try {
        await fn(item);
      } catch (err) {
        console.error('[pool] job failed:', err?.message || err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return Math.max(0, items.length - next); // how many were left for later
}
