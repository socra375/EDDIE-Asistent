// The local probe (Sonda Local): a small FastAPI server on the user's own
// computer that can inspect the machine (disk, memory, CPU, battery). Eddie's
// cloud server can never reach it — only the browser on that same computer
// can — so this entry only describes it for the Conectores hub. Its settings
// (address, key, on/off) live in that browser; see src/services/probe*.js and
// docs/sonda-local.md.
export default {
  id: 'probe',
  name: 'Sonda local (tu equipo)',
  description: 'Eddie le pregunta a la Sonda Local de tu Chromebook cómo está el equipo (disco, memoria, procesador, batería) y te muestra la respuesta con las herramientas que usó.',
  icon: 'monitor',
  category: 'asistente',
  auth: null,
  requiredEnv: [],
  note: 'Solo funciona desde el navegador del mismo equipo donde corre la sonda (http://127.0.0.1:8000). La dirección y la clave se guardan solo en este navegador. Telegram y WhatsApp no pueden llegar a ella.',
  tools: [],
  webhook: null,
};
