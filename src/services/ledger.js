// Cuentas del negocio, the rules without the database: cleaning what the user
// says (kind, amount, dates), the periods of a report, matching an entry by
// words, the totals (in cents, so sums never drift), what is overdue, and the
// invoice draft. Shared by the connector and the morning summary.
//
// An entry (the shape the store returns):
//   id, kind ('ingreso' | 'gasto'), amountCents, currency ('' = never said), concept,
//   category, client, date (YYYY-MM-DD), status ('pagado' | 'pendiente'),
//   dueDate, paidDate (or null), note, createdAt
// Reports are on a cash basis: a paid entry counts on its paid date (or its own date),
// a pending one counts as owed until it is paid.

export const MAX_ENTRIES = 5000;
export const KINDS = ['ingreso', 'gasto'];
export const STATUSES = ['pagado', 'pendiente'];
export const PERIODS = ['hoy', 'ayer', 'semana', 'mes', 'mes_pasado', 'trimestre', 'anio', 'todo'];
export const MAX_INVOICE_ITEMS = 30;

const MAX_CENTS = 10 ** 13;

export const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const KIND_WORDS = {
  ingreso: ['ingreso', 'ingresos', 'venta', 'ventas', 'cobro', 'cobros', 'entrada', 'income'],
  gasto: ['gasto', 'gastos', 'compra', 'compras', 'pago', 'pagos', 'egreso', 'egresos', 'salida', 'expense'],
};
export function cleanKind(value) {
  const v = plain(value).trim();
  return Object.keys(KIND_WORDS).find((k) => KIND_WORDS[k].includes(v)) || null;
}

const STATUS_WORDS = {
  pagado: ['pagado', 'pagada', 'cobrado', 'cobrada', 'saldado', 'saldada', 'liquidado', 'liquidada'],
  pendiente: ['pendiente', 'por cobrar', 'por pagar', 'debe', 'deuda', 'fiado', 'a credito'],
};
export function cleanStatus(value) {
  const v = plain(value).trim();
  return Object.keys(STATUS_WORDS).find((s) => STATUS_WORDS[s].includes(v)) || null;
}

// 250, "250.5", "1,250.50", "1.250,50", "250,5", "3.000" → cents; null for zero, negatives or nonsense.
export function toCents(value) {
  let n;
  if (typeof value === 'number') n = value;
  else {
    let s = String(value ?? '').replace(/[^\d.,]/g, '');
    if (!s) return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      // The later separator is the decimal one.
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1 || /^[1-9]\d{0,2}\.\d{3}$/.test(s)) {
      // «3.000» is three thousand (money almost never has three decimals); «0.500» stays a half.
      s = s.replace(/\./g, '');
    }
    n = Number(s);
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round(n * 100);
  return cents > 0 && cents < MAX_CENTS ? cents : null;
}

export const fromCents = (cents) => Math.round(Number(cents)) / 100;

export function cleanCurrency(value) {
  const v = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : '';
}

export const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function money(cents, currency = '') {
  const text = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(fromCents(cents));
  return currency ? `${text} ${currency}` : text;
}

const shiftDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); // month: 1-12
const pad = (n) => String(n).padStart(2, '0');

// { from, to } (YYYY-MM-DD, inclusive) for a named period around `today`; null ends = no limit.
export function periodRange(period, today) {
  const [y, m] = today.split('-').map(Number);
  switch (period) {
    case 'hoy':
      return { from: today, to: today };
    case 'ayer': {
      const d = shiftDays(today, -1);
      return { from: d, to: d };
    }
    case 'semana': {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday; the week starts on Monday
      return { from: shiftDays(today, -((dow + 6) % 7)), to: today };
    }
    case 'mes_pasado': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: lastDayOf(py, pm) };
    }
    case 'trimestre': {
      const first = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${pad(first)}-01`, to: lastDayOf(y, first + 2) };
    }
    case 'anio':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'todo':
      return { from: null, to: null };
    default:
      return { from: `${y}-${pad(m)}-01`, to: lastDayOf(y, m) };
  }
}

export const effectiveDate = (e) => e.paidDate || e.date;
const within = (date, { from, to }) => (!from || date >= from) && (!to || date <= to);

export const isOverdue = (e, today) => e.status === 'pendiente' && Boolean(e.dueDate) && e.dueDate < today;
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

// The entries that contain every word of `query` in their concept, client or category (or the exact id).
export function matchEntries(entries, query, { limit = 5 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const byId = entries.find((e) => e.id === q);
  if (byId) return [byId];
  const words = plain(q).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  return entries
    .filter((e) => {
      const hay = plain(`${e.concept} ${e.client} ${e.category}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

const group = (map, key, make) => {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
};
const top = (byName, n = 5) =>
  [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([category, cents]) => ({ category: category || 'sin categoría', amount: fromCents(cents) }));

// Totals per currency. income/expense: paid entries dated inside `range`; owedToMe / iOwe:
// everything still pending, whatever its date; overdue: the part of owedToMe past its due date.
export function summarize(entries, { range, today }) {
  const byCurrency = new Map();
  const make = () => ({ income: 0, expense: 0, owedToMe: 0, iOwe: 0, overdue: 0, overdueCount: 0, inc: new Map(), exp: new Map(), paidCount: 0 });
  for (const e of entries) {
    const c = group(byCurrency, e.currency || '', make);
    if (e.status === 'pagado') {
      if (!within(effectiveDate(e), range)) continue;
      c.paidCount += 1;
      if (e.kind === 'ingreso') {
        c.income += e.amountCents;
        c.inc.set(e.category, (c.inc.get(e.category) || 0) + e.amountCents);
      } else {
        c.expense += e.amountCents;
        c.exp.set(e.category, (c.exp.get(e.category) || 0) + e.amountCents);
      }
    } else if (e.kind === 'ingreso') {
      c.owedToMe += e.amountCents;
      if (isOverdue(e, today)) {
        c.overdue += e.amountCents;
        c.overdueCount += 1;
      }
    } else {
      c.iOwe += e.amountCents;
    }
  }
  const currencies = [...byCurrency.entries()]
    .map(([currency, c]) => ({
      currency: currency || 'sin moneda',
      income: fromCents(c.income),
      expense: fromCents(c.expense),
      net: fromCents(c.income - c.expense),
      owedToMe: fromCents(c.owedToMe),
      iOwe: fromCents(c.iOwe),
      overdue: fromCents(c.overdue),
      overdueCount: c.overdueCount,
      entries: c.paidCount,
      topExpenses: top(c.exp),
      topIncome: top(c.inc),
    }))
    .filter((c) => c.entries || c.owedToMe || c.iOwe)
    .sort((a, b) => b.income + b.expense - (a.income + a.expense));
  const followUp = entries
    .filter((e) => e.kind === 'ingreso' && isOverdue(e, today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5)
    .map((e) => ({ id: e.id, client: e.client || null, concept: e.concept, amount: fromCents(e.amountCents), currency: e.currency || null, dueDate: e.dueDate, daysLate: daysBetween(e.dueDate, today) }));
  return { range, currencies, followUp };
}

// The period right before `period` (to compare «este mes» with «el mes pasado»); null for «todo». A week or a day is compared with
// the same stretch one week or one day earlier; a month, quarter or year with the whole one before.
export function previousRange(period, today) {
  const range = periodRange(period, today);
  switch (period) {
    case 'todo':
      return null;
    case 'hoy':
    case 'ayer': {
      const d = shiftDays(range.from, -1);
      return { from: d, to: d };
    }
    case 'semana':
      return { from: shiftDays(range.from, -7), to: shiftDays(range.to, -7) };
    case 'trimestre': {
      const [y, m] = range.from.split('-').map(Number);
      const back = m <= 3 ? { y: y - 1, m: 10 } : { y, m: m - 3 };
      return { from: `${back.y}-${pad(back.m)}-01`, to: lastDayOf(back.y, back.m + 2) };
    }
    case 'anio': {
      const y = Number(range.from.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case 'mes_pasado': {
      const [y, m] = range.from.split('-').map(Number);
      const back = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
      return { from: `${back.y}-${pad(back.m)}-01`, to: lastDayOf(back.y, back.m) };
    }
    default: {
      const [y, m] = range.from.split('-').map(Number);
      const back = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
      return { from: `${back.y}-${pad(back.m)}-01`, to: lastDayOf(back.y, back.m) };
    }
  }
}

// How much did it change against the period before: per currency, % up or down (null when there was nothing before).
export function compareTotals(current, previous) {
  const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
  const before = new Map((previous?.currencies || []).map((c) => [c.currency, c]));
  return (current?.currencies || []).map((c) => {
    const p = before.get(c.currency) || { income: 0, expense: 0, net: 0 };
    return { currency: c.currency, incomeChangePct: pct(c.income, p.income), expenseChangePct: pct(c.expense, p.expense), previousIncome: p.income, previousExpense: p.expense, previousNet: p.net };
  });
}

// Money someone owes the user, grouped by client (an entry with no client stands on its own), the most overdue first:
// what the collections list and the reminder message are built from.
export function receivablesByClient(entries, today) {
  const groups = new Map();
  for (const e of entries) {
    if (e.kind !== 'ingreso' || e.status !== 'pendiente') continue;
    const key = `${plain(e.client || e.concept).trim()}|${e.currency}`;
    if (!groups.has(key)) groups.set(key, { client: e.client || '', currency: e.currency, cents: 0, items: [], oldestDue: null });
    const g = groups.get(key);
    g.cents += e.amountCents;
    g.items.push(e);
    if (e.dueDate && (!g.oldestDue || e.dueDate < g.oldestDue)) g.oldestDue = e.dueDate;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, daysLate: g.oldestDue && g.oldestDue < today ? daysBetween(g.oldestDue, today) : 0, overdue: Boolean(g.oldestDue && g.oldestDue < today) }))
    .sort((a, b) => b.daysLate - a.daysLate || b.cents - a.cents);
}

// A polite first reminder, in plain words (the user's voice is applied by Eddie when he writes the final draft).
export function reminderText(group, { today } = {}) {
  const first = String(group.client || '').trim().split(/\s+/)[0];
  const what = group.items.length === 1 ? `por «${group.items[0].concept}»` : `por ${group.items.length} trabajos`;
  const amount = money(group.cents, group.currency);
  const when = group.overdue ? `venció hace ${group.daysLate} día${group.daysLate === 1 ? '' : 's'}` : group.oldestDue ? `vence el ${group.oldestDue}` : 'sigue pendiente';
  const hello = first ? `Hola ${first}, ¿cómo estás?` : 'Hola, ¿cómo estás?';
  void today;
  return `${hello} Te escribo para recordarte el pago pendiente de ${amount} ${what}, que ${when}. ¿Me confirmas cuándo puedes hacerlo? Gracias.`;
}

// What the morning summary says about money: what is owed to the user and late or due today, and what is to pay today.
export function dueLines(entries, today, { max = 5 } = {}) {
  const who = (e) => (e.client ? `${e.client}` : e.concept);
  const late = entries.filter((e) => e.kind === 'ingreso' && isOverdue(e, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueToday = entries.filter((e) => e.kind === 'ingreso' && e.status === 'pendiente' && e.dueDate === today);
  const toPay = entries.filter((e) => e.kind === 'gasto' && e.status === 'pendiente' && e.dueDate && e.dueDate <= today);
  const lines = [];
  for (const e of late) {
    const days = daysBetween(e.dueDate, today);
    lines.push(`• ${who(e)} te debe ${money(e.amountCents, e.currency)} (venció hace ${days} día${days === 1 ? '' : 's'})`);
  }
  for (const e of dueToday) lines.push(`• ${who(e)} — ${money(e.amountCents, e.currency)} (vence hoy)`);
  for (const e of toPay) lines.push(`• Por pagar: ${e.concept} ${money(e.amountCents, e.currency)}${e.dueDate < today ? ' (vencido)' : ' (hoy)'}`);
  const extra = lines.length - max;
  return extra > 0 ? [...lines.slice(0, max), `• …y ${extra} más`] : lines;
}

// A plain-text invoice or receipt draft with the totals worked out. NOT a tax document.
export function draftInvoice({ client, items, currency, taxPercent, dueDate, notes, today }) {
  const list = (Array.isArray(items) ? items : []).slice(0, MAX_INVOICE_ITEMS);
  const rows = [];
  for (const it of list) {
    const description = cleanText(it?.description, 100);
    const unit = toCents(it?.unit_price);
    const quantity = it?.quantity == null ? 1 : Number(it.quantity);
    if (!description) return { error: 'Cada concepto necesita una descripción.' };
    if (unit == null) return { error: `El concepto «${description}» necesita un precio mayor que cero.` };
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return { error: `La cantidad de «${description}» no es válida.` };
    rows.push({ description, quantity, unit, line: Math.round(quantity * unit) });
  }
  if (!rows.length) return { error: 'Dime al menos un concepto con su precio.' };
  const pct = taxPercent == null ? 0 : Number(taxPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: 'El porcentaje de impuesto debe estar entre 0 y 100.' };
  const subtotal = rows.reduce((s, r) => s + r.line, 0);
  const tax = Math.round((subtotal * pct) / 100);
  const total = subtotal + tax;
  const cur = cleanCurrency(currency);
  const text = [
    '**BORRADOR DE FACTURA / RECIBO** (no es un comprobante fiscal)',
    '',
    `Cliente: ${cleanText(client, 80) || '—'}`,
    `Fecha: ${today}`,
    ...(dueDate ? [`Vence: ${dueDate}`] : []),
    '',
    '| Descripción | Cant. | Precio | Importe |',
    '|---|---:|---:|---:|',
    ...rows.map((r) => `| ${r.description.replace(/\|/g, '/')} | ${r.quantity} | ${money(r.unit, cur)} | ${money(r.line, cur)} |`),
    '',
    `Subtotal: ${money(subtotal, cur)}`,
    ...(pct ? [`Impuesto (${pct} %): ${money(tax, cur)}`] : []),
    `**Total: ${money(total, cur)}**`,
    ...(cleanText(notes, 300) ? ['', `Notas: ${cleanText(notes, 300)}`] : []),
  ].join('\n');
  return { ok: true, text, subtotal: fromCents(subtotal), tax: fromCents(tax), total: fromCents(total), currency: cur || null };
}
