// Exact arithmetic for Eddie: language models get long sums and percentages
// wrong, so they hand the expression to this tool instead. No eval: a small
// recursive-descent parser over numbers, + - * / ^, parentheses, postfix %,
// a few functions and the constants pi and e.

const MAX_LENGTH = 200;
const MAX_DEPTH = 40;

const FUNCTIONS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  min: Math.min,
  max: Math.max,
};
const CONSTANTS = { pi: Math.PI, e: Math.E };

function tokenize(text) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([a-z]+)|([-+*/^%(),×÷]))/giy;
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) {
      if (!text.slice(pos).trim()) break;
      throw new Error(`Carácter no válido cerca de "${text.slice(pos).trim().slice(0, 8)}".`);
    }
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2].toLowerCase() });
    else tokens.push({ t: 'op', v: m[3] === '×' ? '*' : m[3] === '÷' ? '/' : m[3] });
  }
  return tokens;
}

function evaluate(expression) {
  const tokens = tokenize(expression);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;
  const fail = (msg) => {
    throw new Error(msg);
  };

  // expr := term (('+'|'-') term)*    term := unary (('*'|'/') unary)*
  // unary := '-' unary | power        power := postfix ('^' unary)?
  // postfix := atom '%'*              atom := number | const | fn(args) | '(' expr ')'
  function expr(depth) {
    if (depth > MAX_DEPTH) fail('La expresión está demasiado anidada.');
    let value = term(depth);
    while (isOp('+') || isOp('-')) value = tokens[i++].v === '+' ? value + term(depth) : value - term(depth);
    return value;
  }
  function term(depth) {
    let value = unary(depth);
    while (isOp('*') || isOp('/')) {
      const op = tokens[i++].v;
      const right = unary(depth);
      if (op === '/' && right === 0) fail('No se puede dividir entre cero.');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function unary(depth) {
    if (isOp('-')) {
      i += 1;
      return -unary(depth + 1);
    }
    if (isOp('+')) {
      i += 1;
      return unary(depth + 1);
    }
    return power(depth);
  }
  function power(depth) {
    const base = postfix(depth);
    if (isOp('^')) {
      i += 1;
      return base ** unary(depth + 1);
    }
    return base;
  }
  function postfix(depth) {
    let value = atom(depth);
    while (isOp('%')) {
      i += 1;
      value /= 100;
    }
    return value;
  }
  function atom(depth) {
    const tok = tokens[i++];
    if (!tok) return fail('La expresión está incompleta.');
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'op' && tok.v === '(') {
      const value = expr(depth + 1);
      if (!isOp(')')) fail('Falta cerrar un paréntesis.');
      i += 1;
      return value;
    }
    if (tok.t === 'id') {
      if (tok.v in CONSTANTS && !isOp('(')) return CONSTANTS[tok.v];
      const fn = FUNCTIONS[tok.v];
      if (!fn) return fail(`No conozco "${tok.v}".`);
      if (!isOp('(')) return fail(`Faltan paréntesis después de ${tok.v}.`);
      i += 1;
      const args = [];
      if (!isOp(')')) {
        args.push(expr(depth + 1));
        while (isOp(',')) {
          i += 1;
          args.push(expr(depth + 1));
        }
      }
      if (!isOp(')')) fail('Falta cerrar un paréntesis.');
      i += 1;
      if (!args.length) fail(`${tok.v} necesita al menos un número.`);
      return fn(...args);
    }
    return fail(`No esperaba "${tok.v}" ahí.`);
  }

  const value = expr(0);
  if (i < tokens.length) fail(`No esperaba "${tokens[i].v}" ahí.`);
  return value;
}

// Floating-point noise (0.1 + 0.2) rounded away without touching real digits.
function tidy(value) {
  return Number(Number(value).toPrecision(12));
}

export function calculate(args) {
  const expression = String(args.expression || '').trim();
  if (!expression) return { error: 'Falta la expresión a calcular.' };
  if (expression.length > MAX_LENGTH) return { error: `La expresión es demasiado larga (máximo ${MAX_LENGTH} caracteres).` };
  let value;
  try {
    value = evaluate(expression);
  } catch (err) {
    return { error: `No pude calcular "${expression}": ${err.message}` };
  }
  if (!Number.isFinite(value)) return { error: `"${expression}" no da un número válido.` };
  const result = tidy(value);
  return { expression, result, formatted: result.toLocaleString('es', { maximumFractionDigits: 10 }) };
}

export default {
  id: 'calculator',
  name: 'Calculadora',
  description: 'Eddie calcula con exactitud sumas, porcentajes, potencias y raíces en vez de hacerlo de memoria.',
  icon: 'coin',
  category: 'asistente',
  auth: null,
  requiredEnv: [],
  // Always offered: "¿cuánto es el 15% de 80?" has no telltale keyword.
  tools: [
    {
      label: 'Calcular',
      activity: 'Calculando…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => `${result.expression} = ${result.formatted}`,
      declaration: {
        name: 'calculate',
        description:
          'Calcula una expresión matemática con exactitud. Úsala para cualquier cuenta (sumas, porcentajes, propinas, potencias, raíces, promedios) en vez de calcular de memoria. Operadores: + - * / ^ % (postfijo: 15% = 0.15), paréntesis, funciones sqrt, abs, round, floor, ceil, sin, cos, tan, ln, log, exp, min, max, y las constantes pi y e. Usa punto como decimal (3.5), nunca coma.',
        parameters: {
          type: 'OBJECT',
          properties: {
            expression: { type: 'STRING', description: 'La expresión, p. ej. "1250 * 15%" o "sqrt(144) + 2^3".' },
          },
          required: ['expression'],
        },
      },
      run: (args) => calculate(args),
    },
  ],
  webhook: null,
};
