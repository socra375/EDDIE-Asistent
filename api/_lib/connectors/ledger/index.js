// Eddie as the business's administrator and accountant: he keeps the books
// (income, expenses, what is owed to the user and by him), says how the month
// is going, tells who is late paying, and drafts an invoice or receipt. He
// writes down what the user tells him; he never invents an amount, and he is
// not a tax advisor nor a fiscal invoice. Deleting asks for the user's OK on a
// card. Clients are plain names (the same ones as in Negocios and Contactos),
// so «¿cuánto me debe Ana?» and «escríbele a Ana» work together.
import { addEntry, countEntries, deleteEntry, listEntries, updateEntry } from '../../ledger/store.js';
import {
  KINDS, MAX_ENTRIES, PERIODS, STATUSES,
  cleanCurrency, cleanKind, cleanStatus, cleanText, compareTotals, draftInvoice, effectiveDate, fromCents, isOverdue, matchEntries, money, periodRange, plain, previousRange, receivablesByClient, reminderText, summarize, toCents,
} from '../../../../src/services/ledger.js';
import { listBusiness } from '../../business/store.js';
import { listContacts } from '../../contacts/store.js';
import { matchContacts } from '../../../../src/services/contactsCore.js';
import { addDays, resolveDate, todayIn } from '../dates.js';
import { clip } from '../http.js';

const SIGN_IN = 'Para llevar las cuentas inicia sesión con Google (Configuración → Cuenta de Google).';
const MAX_LIST = 30;
const DUPLICATE_WINDOW_MS = 3 * 60 * 1000;

const getUser = async (context) => context.getUser?.();
const tzOf = (context) => context.timezone || 'UTC';

const view = (e, today) => ({
  id: e.id,
  kind: e.kind,
  amount: fromCents(e.amountCents),
  currency: e.currency || null,
  concept: e.concept,
  category: e.category || null,
  client: e.client || null,
  date: e.date,
  status: e.status,
  due_date: e.dueDate,
  paid_date: e.paidDate,
  overdue: isOverdue(e, today) || undefined,
  note: e.note || null,
});

const label = (e) => `${e.kind === 'ingreso' ? 'ingreso' : 'gasto'} de ${money(e.amountCents, e.currency)}: ${clip(e.concept, 60)}`;

// A date argument: undefined → keep going with the default, { error } when it cannot be understood.
function dateArg(value, context, name) {
  // The books look back as much as forward: «ayer» and «anteayer» are everyday words here (dates.js only looks ahead).
  const past = { ayer: -1, anteayer: -2, antier: -2 }[plain(value).trim()];
  if (past) return { value: addDays(todayIn(tzOf(context)), past) };
  const resolved = resolveDate(value, tzOf(context));
  if (resolved === undefined) return { error: `No entendí la fecha de «${name}». Usa AAAA-MM-DD o «hoy», «mañana», «el viernes».` };
  return { value: resolved };
}

async function add(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const kind = cleanKind(args.kind);
  if (!kind) return { error: 'Dime si es un ingreso (dinero que entra) o un gasto (dinero que sale).' };
  const amountCents = toCents(args.amount);
  if (amountCents == null) return { error: 'No entendí el monto: dame un número mayor que cero. No lo inventes: pregúntaselo al usuario.' };
  const concept = cleanText(args.concept, 120);
  if (!concept) return { error: 'Dime de qué es (el concepto: «web para la panadería», «alquiler»…).' };
  const today = todayIn(tzOf(context));
  const date = dateArg(args.date, context, 'date');
  if (date.error) return date;
  const due = dateArg(args.due_date, context, 'due_date');
  if (due.error) return due;
  const status = args.status ? cleanStatus(args.status) : due.value ? 'pendiente' : 'pagado';
  if (!status) return { error: `El estado debe ser uno de: ${STATUSES.join(', ')}.` };
  const entry = {
    kind,
    amountCents,
    currency: cleanCurrency(args.currency),
    concept,
    category: cleanText(args.category, 40),
    client: cleanText(args.client, 80),
    date: date.value || today,
    status,
    dueDate: due.value || null,
    paidDate: null,
    note: cleanText(args.note, 300),
  };
  const entries = await listEntries(user.id);
  // The same thing said twice in a row (the model retrying, a double tap) is written once.
  const twin = entries.find(
    (e) => e.kind === entry.kind && e.amountCents === entry.amountCents && e.date === entry.date && plain(e.concept) === plain(entry.concept) && Date.now() - new Date(e.createdAt).getTime() < DUPLICATE_WINDOW_MS,
  );
  if (twin) return { saved: true, duplicate: true, entry: view(twin, today), summary: `Ya estaba anotado: ${label(twin)}` };
  if (entries.length >= MAX_ENTRIES) return { error: `Ya hay ${MAX_ENTRIES} movimientos guardados, que es el tope. Hay que borrar los más viejos antes de anotar más.` };
  const saved = await addEntry(user.id, entry);
  return {
    saved: true,
    entry: view(saved, today),
    summary: `Anoté ${label(saved)}${saved.status === 'pendiente' ? ' (pendiente)' : ''}`,
    note: 'Dilo en una frase corta con el monto y el concepto. Si el usuario no dijo la moneda y hay otras guardadas, no la adivines.',
  };
}

function filterEntries(entries, args, today) {
  const kind = args.kind ? cleanKind(args.kind) : null;
  const status = args.status ? cleanStatus(args.status) : null;
  const client = plain(args.client).trim();
  const category = plain(args.category).trim();
  const query = plain(args.query).trim();
  const period = PERIODS.includes(args.period) ? args.period : status === 'pendiente' ? 'todo' : 'mes';
  const range = args.from || args.to ? { from: args.from || null, to: args.to || null } : periodRange(period, today);
  const keep = entries.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (status && e.status !== status) return false;
    if (client && !plain(e.client).includes(client)) return false;
    if (category && !plain(e.category).includes(category)) return false;
    if (query && !plain(`${e.concept} ${e.note}`).includes(query)) return false;
    // A pending entry is listed whatever its date (it is still owed); paid ones by the day they count.
    if (e.status === 'pagado') {
      const d = effectiveDate(e);
      if ((range.from && d < range.from) || (range.to && d > range.to)) return false;
    }
    return true;
  });
  return { keep, range, period };
}

async function list(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const today = todayIn(tzOf(context));
  const entries = await listEntries(user.id);
  const { keep, range, period } = filterEntries(entries, args, today);
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), MAX_LIST);
  return {
    count: keep.length,
    period: args.from || args.to ? 'rango' : period,
    range,
    items: keep.slice(0, limit).map((e) => view(e, today)),
    ...(keep.length > limit ? { note: `Se muestran ${limit} de ${keep.length}; los totales cuentan todos.` } : {}),
    totals: summarize(keep, { range, today }).currencies,
    summary: `${keep.length} movimiento${keep.length === 1 ? '' : 's'}`,
  };
}

async function summary(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const today = todayIn(tzOf(context));
  const period = PERIODS.includes(args.period) ? args.period : 'mes';
  const range = periodRange(period, today);
  const entries = await listEntries(user.id);
  if (!entries.length) return { period, range, empty: true, note: 'Todavía no hay movimientos guardados. Pregúntale al usuario por sus ingresos y gastos y anótalos con ledger_add.', summary: 'Sin movimientos todavía' };
  const result = summarize(entries, { range, today });
  // Against the period right before, so «¿cómo voy?» can say whether it is going up or down.
  const beforeRange = previousRange(period, today);
  const comparison = beforeRange ? compareTotals(result, summarize(entries, { range: beforeRange, today })) : [];
  const lines = result.currencies.map((c) => `${c.currency}: entró ${c.income}, salió ${c.expense}, balance ${c.net}`);
  return {
    period,
    ...result,
    ...(beforeRange ? { previous_range: beforeRange, comparison } : {}),
    summary: lines.length ? lines.join(' · ') : 'Sin movimientos en ese periodo',
    note: 'Ingresos y gastos cuentan lo ya pagado en ese periodo; «owedToMe» es lo que le deben al usuario hoy y «iOwe» lo que él debe. Si hay cobros atrasados (followUp), ofrécele escribirle al cliente. «comparison» dice cuánto subió o bajó cada cosa frente al periodo anterior (previous_range): menciónalo en una frase, sin inventar causas. No es asesoría fiscal.',
  };
}

// One entry for the words the user used: the only match, or an error that lists the candidates.
async function collections(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const today = todayIn(tzOf(context));
  let groups = receivablesByClient(await listEntries(user.id), today);
  const wanted = plain(args.client).trim();
  if (wanted) groups = groups.filter((g) => plain(g.client).includes(wanted) || g.items.some((e) => plain(e.concept).includes(wanted)));
  if (!groups.length) return { count: 0, summary: wanted ? 'Nadie con ese nombre te debe' : 'Nadie te debe nada', note: 'No hay cobros pendientes (de ese cliente). Dilo con claridad.' };
  const contacts = await listContacts(user.id).catch(() => []);
  const styles = (await listBusiness(user.id).catch(() => [])).filter((n) => n.area === 'estilo').slice(0, 2).map((n) => clip(n.summary || n.title, 120));
  const items = groups.slice(0, 12).map((g) => {
    const found = g.client ? matchContacts(contacts, g.client, { limit: 2 }) : [];
    const contact = found.length === 1 ? found[0] : null;
    return {
      client: g.client || null,
      total: fromCents(g.cents),
      currency: g.currency || null,
      overdue: g.overdue || undefined,
      days_late: g.overdue ? g.daysLate : undefined,
      oldest_due: g.oldestDue,
      entries: g.items.map((e) => ({ id: e.id, concept: e.concept, amount: fromCents(e.amountCents), due_date: e.dueDate })),
      contact: contact ? { name: contact.name, has_phone: Boolean(contact.phone) } : found.length > 1 ? { ambiguous: found.map((c) => c.name) } : null,
      suggested_message: reminderText(g, { today }),
    };
  });
  const overdue = items.filter((i) => i.overdue).length;
  return {
    count: groups.length,
    overdue,
    items,
    ...(styles.length ? { user_tone: styles } : {}),
    summary: `${groups.length} cobro${groups.length === 1 ? '' : 's'} pendiente${groups.length === 1 ? '' : 's'}${overdue ? `, ${overdue} atrasado${overdue === 1 ? '' : 's'}` : ''}`,
    note: 'Cuéntaselo en pocas líneas (a quién, cuánto, cuántos días de atraso). Si quiere recordárselo a alguien, escribe el mensaje con SU tono (user_tone) a partir de suggested_message y deja el borrador con prepare_message (Contactos); el usuario lo envía, tú no. Si el contacto no existe o no tiene teléfono, dilo y ofrece guardarlo. No reclames con dureza ni inventes cargos.',
  };
}

async function pick(user, args, today) {
  const entries = await listEntries(user.id);
  const query = args.id || args.query;
  if (!String(query ?? '').trim()) return { error: 'Dime cuál movimiento (el id de ledger_list, o su concepto o cliente).' };
  const found = matchEntries(entries, query, { limit: 6 });
  if (!found.length) return { error: 'No encontré ningún movimiento así. Mira la lista con ledger_list.' };
  if (found.length > 1) {
    return { error: `Hay varios movimientos que encajan: ${found.map((e) => `${e.id.slice(0, 8)}… ${e.client ? `${e.client} — ` : ''}${e.concept} (${money(e.amountCents, e.currency)}, ${e.date})`).join('; ')}. Pásame el id completo de ledger_list o pregúntale al usuario cuál.` };
  }
  return { entry: found[0], today };
}

async function update(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const today = todayIn(tzOf(context));
  const picked = await pick(user, args, today);
  if (picked.error) return picked;
  const old = picked.entry;
  const next = { ...old };
  if (args.status != null) {
    const status = cleanStatus(args.status);
    if (!status) return { error: `El estado debe ser uno de: ${STATUSES.join(', ')}.` };
    next.status = status;
  }
  for (const [arg, key, name] of [['date', 'date', 'date'], ['due_date', 'dueDate', 'due_date'], ['paid_date', 'paidDate', 'paid_date']]) {
    if (args[arg] == null) continue;
    const d = dateArg(args[arg], context, name);
    if (d.error) return d;
    next[key] = d.value || next[key];
  }
  if (args.amount != null) {
    const cents = toCents(args.amount);
    if (cents == null) return { error: 'No entendí el monto nuevo: dame un número mayor que cero.' };
    next.amountCents = cents;
  }
  if (args.new_concept != null) next.concept = cleanText(args.new_concept, 120) || next.concept;
  if (args.category != null) next.category = cleanText(args.category, 40);
  if (args.client != null) next.client = cleanText(args.client, 80);
  if (args.currency != null) next.currency = cleanCurrency(args.currency);
  if (args.note != null) next.note = cleanText(args.note, 300);
  // Settling a pending entry stamps the day it was paid; going back to pending clears it.
  if (next.status === 'pagado' && old.status === 'pendiente' && !args.paid_date) next.paidDate = today;
  if (next.status === 'pendiente') next.paidDate = null;
  const saved = await updateEntry(user.id, old.id, next);
  if (!saved) return { error: 'Ese movimiento ya no existe.' };
  const settled = old.status === 'pendiente' && saved.status === 'pagado';
  return {
    updated: true,
    entry: view(saved, today),
    summary: settled ? `Marqué como pagado: ${label(saved)}` : `Actualicé ${label(saved)}`,
  };
}

async function prepareDelete(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const picked = await pick(user, args, todayIn(tzOf(context)));
  if (picked.error) return picked;
  const e = picked.entry;
  return {
    args: { id: e.id },
    preview: {
      title: 'Borrar un movimiento',
      confirmLabel: 'Borrar',
      danger: true,
      fields: [
        { key: 'kind', label: 'Tipo', value: e.kind === 'ingreso' ? 'Ingreso' : 'Gasto' },
        { key: 'amount', label: 'Monto', value: money(e.amountCents, e.currency) },
        { key: 'concept', label: 'Concepto', value: e.concept },
        { key: 'date', label: 'Fecha', value: e.date },
        ...(e.client ? [{ key: 'client', label: 'Cliente', value: e.client }] : []),
        { key: 'status', label: 'Estado', value: e.status },
      ],
    },
  };
}

async function remove(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const gone = await deleteEntry(user.id, String(args.id || ''));
  return gone ? { deleted: true, summary: 'Borré el movimiento' } : { error: 'Ese movimiento ya no existe.' };
}

const PERIOD_ARG = { type: 'STRING', enum: PERIODS, description: 'Periodo: hoy, ayer, semana, mes, mes_pasado, trimestre, anio o todo.' };

export default {
  id: 'ledger',
  // A specialist: when a request touches two of these, Eddie hands each its part (see delegation/).
  role: { name: 'Contador', does: 'las cuentas: anotar ingresos y gastos, cuánto entró, salió o te deben, cobros atrasados, borradores de factura' },
  name: 'Cuentas del negocio',
  description:
    'Eddie lleva las cuentas como tu administrador y contador: anota ingresos y gastos cuando se los cuentas, dice cuánto entró, salió y cuánto te deben, avisa quién está atrasado y te prepara un borrador de factura o recibo. No inventa montos ni es asesor fiscal.',
  icon: 'coin',
  category: 'asistente',
  route:
    /c[oó]br|deb(e|en|o|er[eé])\b|me deben|te debe|gast[eoéa]|ingres|ventas?\b|vend[ií]|factur|recibo|pagu[eé]|pag[oó]|cuenta|balance|ganancia|gané|utilidad|contab|contador|presupuest|dinero|finanza|n[oó]mina|impuesto|cu[aá]nto (gan|gast|me deben|debo|entr|sal)|fiado|abono/i,
  companions: ['contacts'],
  guide: `CUENTAS DEL NEGOCIO — cómo y cuándo:
1. En cuanto el usuario cuente un ingreso o gasto, anótalo con ledger_add sin pedírselo y dilo en una frase corta con monto y concepto. Si falta el monto, pregúntalo; nunca inventes montos, fechas ni moneda.
2. «Me deben», «fiado», «pagará el viernes» = pendiente con due_date. «Ya me pagó» = ledger_update con status pagado (no crees otro ingreso).
3. Si dos movimientos encajan (dos Anas), pregunta cuál; no adivines. Borrar es ledger_delete (pide tarjeta).
4. «¿Cómo voy?», «cuánto gané o gasté» = ledger_summary; di en una frase si sube o baja frente al periodo anterior, sin inventar causas.
5. «¿Quién me debe?» = ledger_collections. Si hay atrasados, ofrece recordárselo; si acepta, escribe el mensaje con su tono a partir del texto sugerido y déjalo como borrador con prepare_message (Contactos). El usuario lo envía, tú no.
6. Factura o recibo: invoice_draft con los precios que dijo; recuérdale que es un borrador, no un comprobante fiscal, y ofrece anotarlo como cobro pendiente.
7. No des asesoría fiscal ni legal: para impuestos, que lo consulte con un contador.
8. Si suele haber atrasados, ofrece una rutina diaria («todos los días a las 8 dime si alguien se atrasó») y créala solo si acepta.`,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Solo con sesión iniciada. Guarda ingresos, gastos y cobros o pagos pendientes (con fecha de vencimiento), por moneda; el resumen de la mañana te avisa de los cobros atrasados. Es contabilidad básica de apoyo: no declara impuestos ni emite comprobantes fiscales. Borrar pide tu confirmación. Tope de 5000 movimientos.',
  details: async (user) => ({ items: user ? await countEntries(user.id) : 0 }),
  tools: [
    {
      label: 'Anotar ingreso o gasto',
      activity: 'Anotando en las cuentas…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'ledger_add',
        description:
          'Anota en las cuentas del negocio un ingreso (dinero que entra: una venta, un cobro) o un gasto (dinero que sale: alquiler, compra, pago), cuando el usuario lo cuenta («vendí una web por 250», «pagué 80 de luz», «Ana me debe 100 hasta el viernes»). Una llamada por movimiento. Con due_date queda como pendiente (por cobrar o por pagar) hasta que se marque pagado con ledger_update. NUNCA inventes un monto, una fecha ni la moneda: si falta el monto, pregúntalo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            kind: { type: 'STRING', enum: KINDS, description: 'ingreso (entra dinero) o gasto (sale dinero).' },
            amount: { type: 'NUMBER', description: 'El monto, mayor que cero.' },
            concept: { type: 'STRING', description: 'De qué es, corto: «web para panadería», «alquiler de mayo».' },
            client: { type: 'STRING', description: 'El cliente (o proveedor), con el mismo nombre que en Contactos y Negocios.' },
            category: { type: 'STRING', description: 'Categoría opcional: ventas, alquiler, publicidad, transporte…' },
            date: { type: 'STRING', description: 'Cuándo ocurrió: AAAA-MM-DD o «hoy», «ayer». Si no lo dijo, hoy.' },
            status: { type: 'STRING', enum: STATUSES, description: 'pagado (ya se cobró o pagó) o pendiente. Por defecto pagado, o pendiente si hay due_date.' },
            due_date: { type: 'STRING', description: 'Hasta cuándo debe cobrarse o pagarse (AAAA-MM-DD o «el viernes»).' },
            currency: { type: 'STRING', description: 'Moneda en 3 letras (USD, DOP, EUR…), solo si el usuario la dijo.' },
            note: { type: 'STRING', description: 'Nota opcional.' },
          },
          required: ['kind', 'amount', 'concept'],
        },
      },
      run: (args, context) => add(args, context),
    },
    {
      label: 'Ver movimientos',
      activity: 'Revisando las cuentas…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'ledger_list',
        description:
          'Lista los movimientos de las cuentas con sus totales por moneda: «¿qué gasté este mes?», «¿qué le vendí a Ana?», «¿quién me debe?» (status pendiente). Los pendientes salen siempre, sea cual sea su fecha; con overdue: true ya pasó su vencimiento. Devuelve los id para ledger_update y ledger_delete.',
        parameters: {
          type: 'OBJECT',
          properties: {
            period: PERIOD_ARG,
            from: { type: 'STRING', description: 'Desde (AAAA-MM-DD), en vez de period.' },
            to: { type: 'STRING', description: 'Hasta (AAAA-MM-DD), en vez de period.' },
            kind: { type: 'STRING', enum: KINDS, description: 'Solo ingresos o solo gastos.' },
            status: { type: 'STRING', enum: STATUSES, description: 'pendiente = lo que falta cobrar o pagar; pagado = lo ya liquidado.' },
            client: { type: 'STRING', description: 'Solo de este cliente o proveedor.' },
            category: { type: 'STRING', description: 'Solo de esta categoría.' },
            query: { type: 'STRING', description: 'Palabras del concepto o la nota.' },
            limit: { type: 'INTEGER', description: 'Cuántos mostrar (máx. 30).' },
          },
        },
      },
      run: (args, context) => list(args, context),
    },
    {
      label: 'Resumen de cuentas',
      activity: 'Sacando las cuentas…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'ledger_summary',
        description:
          'Cómo van las cuentas en un periodo: lo que entró, lo que salió y el balance por moneda, en qué se gasta más, lo que le deben al usuario (y lo atrasado, con a quién cobrarle) y lo que él debe. Úsala para «¿cómo voy este mes?», «¿cuánto gané?», «¿quién me debe?».',
        parameters: { type: 'OBJECT', properties: { period: PERIOD_ARG } },
      },
      run: (args, context) => summary(args, context),
    },
    {
      label: 'Cobros pendientes',
      activity: 'Revisando quién te debe…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'ledger_collections',
        description:
          'Lista lo que le deben al usuario, por cliente y con los más atrasados primero, con su contacto de Contactos y un texto sugerido de recordatorio amable. Úsala para «¿quién me debe?», «¿a quién le cobro?» y antes de redactar un cobro. Con client mira solo a esa persona. No envía nada.',
        parameters: { type: 'OBJECT', properties: { client: { type: 'STRING', description: 'Solo este cliente (opcional).' } } },
      },
      run: (args, context) => collections(args, context),
    },
    {
      label: 'Corregir o marcar pagado',
      activity: 'Actualizando las cuentas…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'ledger_update',
        description:
          'Cambia un movimiento ya anotado. Lo habitual: marcar como pagado un cobro o pago pendiente («Ana ya me pagó»: status pagado). También corrige monto, concepto, fecha, vencimiento, cliente, categoría o nota. Indica cuál con id (de ledger_list) o con query (concepto o cliente); si hay varios que encajan, te lo dice.',
        parameters: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', description: 'El id del movimiento (de ledger_list).' },
            query: { type: 'STRING', description: 'Concepto o cliente, si no tienes el id.' },
            status: { type: 'STRING', enum: STATUSES, description: 'pagado o pendiente.' },
            paid_date: { type: 'STRING', description: 'El día que se pagó, si no fue hoy.' },
            amount: { type: 'NUMBER', description: 'Monto corregido.' },
            new_concept: { type: 'STRING', description: 'Concepto corregido.' },
            client: { type: 'STRING', description: 'Cliente corregido.' },
            category: { type: 'STRING', description: 'Categoría.' },
            date: { type: 'STRING', description: 'Fecha corregida.' },
            due_date: { type: 'STRING', description: 'Nuevo vencimiento.' },
            currency: { type: 'STRING', description: 'Moneda en 3 letras.' },
            note: { type: 'STRING', description: 'Nota.' },
          },
        },
      },
      run: (args, context) => update(args, context),
    },
    {
      label: 'Borrar un movimiento',
      activity: 'Preparando la confirmación…',
      risk: 'confirm',
      sensitive: true,
      declaration: {
        name: 'ledger_delete',
        description: 'Borra un movimiento de las cuentas (uno anotado por error). Siempre pide confirmación con una tarjeta; tú solo la propones. Indica cuál con id o con query.',
        parameters: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', description: 'El id del movimiento (de ledger_list).' },
            query: { type: 'STRING', description: 'Concepto o cliente, si no tienes el id.' },
          },
        },
      },
      prepare: (args, context) => prepareDelete(args, context),
      run: (args, context) => remove(args, context),
    },
    {
      label: 'Borrador de factura o recibo',
      activity: 'Armando el borrador…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : `Borrador: ${result?.total}${result?.currency ? ` ${result.currency}` : ''}`),
      declaration: {
        name: 'invoice_draft',
        description:
          'Prepara el texto de un borrador de factura o recibo con los totales ya calculados, para que el usuario lo revise y lo copie. No guarda nada ni es un comprobante fiscal: dilo. Los precios y cantidades los dice el usuario; no los inventes. Si lo pide también como cobro pendiente, anótalo luego con ledger_add (ingreso, pendiente, con due_date).',
        parameters: {
          type: 'OBJECT',
          properties: {
            client: { type: 'STRING', description: 'A quién va dirigido.' },
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  description: { type: 'STRING', description: 'Qué se cobra.' },
                  quantity: { type: 'NUMBER', description: 'Cantidad (1 si no la dijo).' },
                  unit_price: { type: 'NUMBER', description: 'Precio de cada unidad.' },
                },
                required: ['description', 'unit_price'],
              },
              description: 'Los conceptos a cobrar.',
            },
            currency: { type: 'STRING', description: 'Moneda en 3 letras, si la dijo.' },
            tax_percent: { type: 'NUMBER', description: 'Porcentaje de impuesto, solo si el usuario lo dijo.' },
            due_date: { type: 'STRING', description: 'Fecha límite de pago (AAAA-MM-DD o «el viernes»).' },
            notes: { type: 'STRING', description: 'Notas al pie (forma de pago, cuenta…), solo si las dijo.' },
          },
          required: ['items'],
        },
      },
      run: (args, context) => {
        const today = todayIn(tzOf(context));
        const due = dateArg(args.due_date, context, 'due_date');
        if (due.error) return due;
        const out = draftInvoice({ client: args.client, items: args.items, currency: args.currency, taxPercent: args.tax_percent, dueDate: due.value, notes: args.notes, today });
        return out.error ? out : { ...out, note: 'Muéstrale el texto completo. Recuérdale que es un borrador, no un comprobante fiscal, y ofrécele anotarlo como cobro pendiente.' };
      },
    },
  ],
  webhook: null,
};
