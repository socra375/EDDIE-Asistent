// POST /api/chat?action=confirm — the user pressed "Confirmar" on a card in
// the chat, so the sensitive action Eddie proposed (see createToolset and
// confirmTool in connectors/registry.js) runs now, with the card's
// arguments. The model isn't called again; the answer is the tool's result
// plus any app changes (actions) for the browser to apply.
import { isTrustedRequest } from './requestGuard.js';
import { confirmTool } from './connectors/registry.js';
import { sanitizeConnectorIds, sanitizeContext } from './handler.js';
import { parseCookies } from './cookies.js';
import { lazySessionUser } from './session.js';

const TOOL_NAME_RE = /^[a-z0-9_]{1,64}$/;

export async function runConfirm(req, res) {
  // Only Eddie's own pages can confirm an action; browsers flag cross-site
  // requests, so another site can't trigger one with the user's session.
  if (!isTrustedRequest(req)) {
    res.status(403).json({ error: 'Origen no permitido.' });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { tool, args } = body;
  if (typeof tool !== 'string' || !TOOL_NAME_RE.test(tool) || !args || typeof args !== 'object' || Array.isArray(args)) {
    res.status(400).json({ error: 'Solicitud de confirmación no válida.' });
    return;
  }
  try {
    const outcome = await confirmTool({
      name: tool,
      args,
      disabled: sanitizeConnectorIds(body.disabledConnectors),
      context: { ...sanitizeContext(body.context), getUser: lazySessionUser(parseCookies(req.headers.cookie)) },
    });
    if (outcome.error) {
      res.status(422).json({ error: outcome.error });
      return;
    }
    res.status(200).json({ ok: true, result: outcome.result, actions: outcome.actions });
  } catch (err) {
    console.error('[confirm] unexpected error:', err);
    res.status(500).json({ error: 'No se pudo completar la acción.' });
  }
}
