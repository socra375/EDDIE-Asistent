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
};
