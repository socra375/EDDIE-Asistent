// Shared retry-with-backoff wrapper around fetch, used by both the AI
// provider calls (providers.js) and the tool calls Eddie makes on its own
// (tools.js) — a transient network hiccup or a "come back later" status
// from either an AI provider or Open-Meteo shouldn't fail the whole request.
//
// `options` may be a plain fetch options object, or a function returning one
// — use the function form whenever options carries a one-shot AbortSignal
// (e.g. AbortSignal.timeout(ms)), so each retry attempt gets its own fresh
// signal instead of reusing one that may have already fired.
export async function fetchWithRetry(url, options, { retries = 1, retryableStatusCodes = [], backoffMs = 700 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, typeof options === 'function' ? options() : options);
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
      continue;
    }
    if (res.ok || attempt >= retries || !retryableStatusCodes.includes(res.status)) {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
  }
}
