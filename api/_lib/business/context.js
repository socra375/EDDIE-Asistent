// What Eddie knows about the business, handed to him before an answer (the chat
// and Telegram both use it) and the same facts for his tools.
import { listBusiness } from './store.js';
import { formatBusinessForPrompt } from '../../../src/services/business.js';

// Never throws and never blocks an answer for long: no block is better than a failed reply.
export async function businessBlock({ userId, messages }) {
  if (!process.env.DATABASE_URL || !userId) return '';
  try {
    const last = Array.isArray(messages) ? messages.filter((m) => m?.role === 'user').at(-1) : null;
    const text = typeof last?.content === 'string' ? last.content : '';
    const nodes = await listBusiness(userId, { limit: 200 });
    return formatBusinessForPrompt(nodes, text);
  } catch (err) {
    console.error('[business] context failed:', err.message);
    return '';
  }
}
