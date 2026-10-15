// What must never be kept in Eddie's memories: passwords, API keys, tokens, card numbers. One place, shared by
// the memory (browser and server), the analysis of conversations and documents, the summaries of conversations
// and the memory tools, so no door lets through what another one stops.
//
// Two kinds of check, because a word and a value are different things:
//   - looksSecret: the text talks about a secret ("mi contraseña es…", "token", "tarjeta") or holds a value that
//     looks like one. Used on short facts, where being strict costs nothing.
//   - redactSecrets: only the VALUES are cut out ("[dato sensible omitido]"), so a summary or a document keeps its
//     meaning ("preguntó cómo cambiar su contraseña") without the secret itself. Used before text goes to the AI
//     and before a summary is kept.

export const REDACTED = '[dato sensible omitido]';

// Words that point at a secret.
const WORDS_RE = /contrase[ñn]a|password|passwd|api[ _-]?key|secret|token|clave (de|del|privada)|tarjeta|cvv|iban/i;

// Shapes of real secrets: known key prefixes, long mixed letters-and-digits strings, card numbers, private keys.
const VALUE_SOURCES = [
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
  String.raw`\bsk-[A-Za-z0-9_-]{16,}`,
  String.raw`\bAIza[0-9A-Za-z_-]{20,}`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{20,}`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
  String.raw`\bAKIA[0-9A-Z]{16}\b`,
  String.raw`\b[a-z]{2,8}_(?:live|test|prod)_[A-Za-z0-9]{12,}`,
  String.raw`\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*`,
  String.raw`\b(?:\d[ -]?){13,19}\b`,
  String.raw`\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}\b`,
];

// "la contraseña es hunter2", "token: abc123": the word, the link (es / : / =), and the value that follows it.
// «clave» and «token» are also everyday words ("la clave del éxito"), so there the value must look like one (a digit or a symbol).
const VALUE_CHARS = String.raw`["“«']?`;
// «contraseña del panel es…», «clave de acceso: …», «token para el servidor = …»: what the secret is for.
const OF_WHAT = String.raw`(?:\s+(?:de|del|para|en)(?:\s+(?:la|el|los|las))?\s+\w+)?`;
const LABELED_SOURCES = [
  String.raw`((?:contrase[ñn]a|password|passwd|api[ _-]?key|secret)\w*${OF_WHAT}\s*(?:es|era|fue|:|=)\s*)${VALUE_CHARS}[^\s"”»',;]{4,}`,
  String.raw`((?:clave|token)\w*${OF_WHAT}\s*(?:es|era|fue|:|=)\s*)${VALUE_CHARS}(?=[^\s"”»',;]*[\d_@#$%!*&])[^\s"”»',;]{4,}`,
];

const valueRes = () => VALUE_SOURCES.map((s) => new RegExp(s, 'g'));

export function hasSecretValue(text) {
  const t = String(text ?? '');
  return valueRes().some((re) => re.test(t));
}

export function looksSecret(text) {
  const t = String(text ?? '');
  return WORDS_RE.test(t) || hasSecretValue(t);
}

export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const source of LABELED_SOURCES) out = out.replace(new RegExp(source, 'gi'), (_m, lead) => `${lead}${REDACTED}`);
  for (const re of valueRes()) out = out.replace(re, REDACTED);
  return out;
}
