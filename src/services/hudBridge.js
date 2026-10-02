// How the chat tells the home screen what to show without importing it:
// "Activa sistema" / "Desactiva sistema" / "Dame los datos de hoy" (see
// parseHudCommand in commands.js). detail.action: 'show' | 'hide' | 'today'.
export const HUD_EVENT = 'eddie:hud';

// Panels of the system, in the order they show (and are told) in the briefing.
export const HUD_PANELS = ['weather', 'tasks', 'system', 'uptime'];
