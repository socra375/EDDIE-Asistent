// Remote view, on the device that is being watched. While another of the
// user's devices asks to see this camera, a picture goes out about every
// second (see devices/DeviceBridge.jsx); this small store says whether that is
// happening, so the header and the camera panel can say so out loud.
const listeners = new Set();
let state = { sharing: false, since: 0 };

export const shareState = () => state;

export function setSharing(sharing) {
  if (state.sharing === sharing) return;
  state = { sharing, since: sharing ? Date.now() : 0 };
  listeners.forEach((listener) => listener());
}

export function subscribeShare(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The viewer's side: "show me this device's camera" (opens the floating viewer).
export const REMOTE_VIEW_EVENT = 'eddie:remote-view'; // detail: { deviceId, name, attach? } to open it, { deviceId, close: true } to close it
