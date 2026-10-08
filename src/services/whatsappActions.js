// The WhatsApp drafts Eddie's tools emit (see api/_lib/connectors/whatsapp): each
// one becomes a button that opens WhatsApp with the message already written. Only
// a plain wa.me address is accepted, so a bad action can never become a link to
// anywhere else.
const WA = /^https:\/\/wa\.me\/(\d{8,15})?\?text=[^\s]+$/;

// → [{ url, text, label }] for the reply to show under the message.
export function applyWhatsappActions(actions) {
  const drafts = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type !== 'whatsapp_draft') continue;
    const url = String(action.url || '');
    if (!WA.test(url) || url.length > 3500) continue;
    if (drafts.some((d) => d.url === url)) continue;
    drafts.push({ url, text: String(action.text || '').slice(0, 1000), label: String(action.label || '').slice(0, 60) });
  }
  return drafts.slice(0, 3);
}
