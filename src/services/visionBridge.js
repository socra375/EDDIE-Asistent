// How the chat talks to the camera without importing it: Modo Vigilancia
// (context/VisionContext.jsx) fills these in while it is mounted, and the chat
// asks them for "¿qué ves?" and for the wording of its answers to the command.
export const VIGILANCE_EVENT = 'eddie:vigilance';

export const visionBridge = {
  isActive: () => false,
  hasConsent: () => true,
  isSupported: () => true,
  // → { mimeType, data, thumb, name } for the current camera frame, or null.
  getFrame: async () => null,
  // 'auto' | 'local' | 'cloud': who looks at the picture (see Configuración → Cámara).
  engine: () => 'auto',
  // What the camera sees now, in words, from the detector's list ("¿qué ves?").
  describe: () => '',
  // 'off' | 'consent' | 'starting' | 'watching' | 'error' (and the error text), for remote commands.
  status: () => ({ phase: 'off', error: '' }),
  // A small picture of what the camera sees now plus what was found in it (for the remote view): { data (base64 JPEG), meta } or null.
  snapshot: () => null,
};
