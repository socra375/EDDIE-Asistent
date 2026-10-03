// Gemini's "-latest" Flash models think before they answer, and for a voice
// assistant those invisible seconds are the biggest part of the wait. Eddie
// asks for as little thinking as the model allows: `thinkingBudget: 0` on
// Gemini 2.5, `thinkingLevel: "minimal"` on Gemini 3. The field that works is
// not the same across the snapshots behind a "-latest" alias, and a wrong one
// makes Gemini answer 400, so each model walks down this ladder the first time
// one is refused and remembers where it stopped (for as long as the server
// instance lives). GEMINI_THINKING=default switches all of this off.
const LADDER = [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null];
const position = new Map(); // model → index in LADDER

// → { thinkingConfig } to spread into generationConfig, or {} for the model's own default.
export function thinkingFor(model, env = process.env) {
  if (String(env.GEMINI_THINKING || '').toLowerCase() === 'default') return {};
  // Pro models cannot go below a minimum of thinking and are chosen for it: left as they are.
  if (/pro/i.test(model)) return {};
  const config = LADDER[position.get(model) ?? 0];
  return config ? { thinkingConfig: config } : {};
}

// A 400 that is about the thinking settings (or an unnamed "invalid argument", the usual wording).
export function rejectsThinking(status, message) {
  return status === 400 && /thinking|invalid argument|unknown name/i.test(String(message || ''));
}

// Moves the model to the next setting; false when nothing is left to try.
export function nextThinking(model) {
  const at = position.get(model) ?? 0;
  if (at >= LADDER.length - 1 || !LADDER[at]) return false;
  position.set(model, at + 1);
  return true;
}

export function resetThinking() {
  position.clear();
}
