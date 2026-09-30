// Exchange rates from open.er-api.com (ExchangeRate-API's open endpoint):
// free, keyless, updated once a day — fine for conversions, not for trading.
import { fetchJson } from '../http.js';

const CODE_RE = /^[A-Z]{3}$/;
// Common names people say instead of ISO codes.
const ALIASES = {
  PESO: 'DOP',
  PESOS: 'DOP',
  RD: 'DOP',
  'RD$': 'DOP',
  DOLAR: 'USD',
  DOLARES: 'USD',
  DÓLAR: 'USD',
  DÓLARES: 'USD',
  'US$': 'USD',
  EURO: 'EUR',
  EUROS: 'EUR',
};

export function normalizeCurrency(value) {
  const raw = String(value || '').trim().toUpperCase();
  return ALIASES[raw] || raw;
}

async function convertCurrency(args) {
  const from = normalizeCurrency(args.from);
  const to = normalizeCurrency(args.to);
  const amount = args.amount ?? 1;
  if (!CODE_RE.test(from) || !CODE_RE.test(to)) return { error: 'Usa códigos de moneda de 3 letras, p. ej. USD, DOP, EUR.' };
  if (!Number.isFinite(amount) || amount < 0) return { error: 'La cantidad debe ser un número positivo.' };

  const { ok, data } = await fetchJson(`https://open.er-api.com/v6/latest/${from}`, { timeoutMs: 6000 });
  if (!ok || data?.result !== 'success') {
    return { error: data?.['error-type'] === 'unsupported-code' ? `La moneda ${from} no está disponible.` : 'No se pudo consultar la tasa de cambio ahora.' };
  }
  const rate = data.rates?.[to];
  if (typeof rate !== 'number') return { error: `La moneda ${to} no está disponible.` };
  return {
    amount,
    from,
    to,
    rate,
    result: Math.round(amount * rate * 100) / 100,
    updated: data.time_last_update_utc || null,
    source: 'ExchangeRate-API (open.er-api.com), tasa de referencia diaria',
  };
}

export default {
  id: 'currency',
  name: 'Monedas',
  description: 'Convierte entre monedas con la tasa de cambio del día (dólar, peso, euro y 160 más).',
  icon: 'coin',
  auth: null,
  requiredEnv: [],
  tools: [
    {
      label: 'Convertir monedas',
      sensitive: false,
      declaration: {
        name: 'convert_currency',
        description: 'Convierte una cantidad de una moneda a otra con la tasa de referencia del día, o da la tasa si amount es 1.',
        parameters: {
          type: 'OBJECT',
          properties: {
            amount: { type: 'NUMBER', description: 'Cantidad a convertir (1 si solo preguntan la tasa).' },
            from: { type: 'STRING', description: 'Código ISO de la moneda de origen, p. ej. "USD".' },
            to: { type: 'STRING', description: 'Código ISO de la moneda de destino, p. ej. "DOP".' },
          },
          required: ['from', 'to'],
        },
      },
      run: (args) => convertCurrency(args),
    },
  ],
  webhook: null,
};
