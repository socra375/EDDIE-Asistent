// The SMS and Instagram drafts Eddie's tools emit (see api/_lib/connectors/contacts).
// WhatsApp drafts have their own (whatsappActions.js). Only an sms: address with a
// number or an ig.me chat address is accepted, so a bad action can never become a
// link to anywhere else.
const SMS = /^sms:\+\d{8,15}(\?&body=[^\s]+)?$/;
const INSTAGRAM = /^https:\/\/ig\.me\/m\/[A-Za-z0-9._]{1,30}$/;

export const isSafeMessageUrl = (channel, url) => (channel === 'sms' ? SMS.test(url) : channel === 'instagram' ? INSTAGRAM.test(url) : false) && url.length <= 3500;

// → [{ channel, url, text, label }] for the reply to show under the message.
export function applyMessageActions(actions) {
  const drafts = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type !== 'message_draft') continue;
    const url = String(action.url || '');
    if (!isSafeMessageUrl(action.channel, url)) continue;
    if (drafts.some((d) => d.url === url)) continue;
    drafts.push({ channel: action.channel, url, text: String(action.text || '').slice(0, 1000), label: String(action.label || '').slice(0, 60) });
  }
  return drafts.slice(0, 3);
}

// Instagram has no link that fills in the message, so it is copied first and the chat opens next to it.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
