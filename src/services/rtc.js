// Live video between two of the user's devices (WebRTC): the watched device
// sends its camera straight to the screen that is watching (no server in the
// middle, so it is smooth: ~20 pictures a second instead of one), and a data
// channel carries what the detector found, for the boxes and the narration.
// The two browsers find each other through small messages kept for a moment on
// the server (api/_lib/devices, "signals"); if no direct path exists the
// callers fall back to the slower one-picture-a-second view.

export const rtcSupported = () => typeof RTCPeerConnection !== 'undefined';

const POLL_MS = 400;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What the browser gives, as a plain object that can be sent as JSON.
const candidateJson = (candidate) => (candidate ? candidate.toJSON() : { candidate: null });

function pollSignals(isOpen, take, handle) {
  (async () => {
    while (isOpen()) {
      try {
        for (const signal of (await take()).signals || []) await handle(signal);
      } catch {
        // The next round tries again.
      }
      await wait(POLL_MS);
    }
  })();
}

// The screen that watches. It offers; the device answers.
//   post(kind, payload) sends a message to the device; take() → { signals } waiting for this screen.
//   onStream(MediaStream), onMeta(object), onState('connecting' | 'connected' | 'disconnected' | 'failed' | 'closed')
export function createViewerRtc({ iceServers, post, take, onStream, onMeta, onState }) {
  const pc = new RTCPeerConnection({ iceServers });
  let open = true;
  let polling = false;
  const queued = [];
  pc.addTransceiver('video', { direction: 'recvonly' });
  const channel = pc.createDataChannel('meta');
  channel.onmessage = (e) => {
    try {
      onMeta(JSON.parse(e.data));
    } catch {
      // A broken message is skipped.
    }
  };
  pc.ontrack = (e) => onStream(e.streams[0] || new MediaStream([e.track]));
  pc.onicecandidate = (e) => post('ice', candidateJson(e.candidate)).catch(() => {});
  pc.onconnectionstatechange = () => {
    onState(pc.connectionState);
    if (pc.connectionState === 'connected') polling = false; // nothing more to exchange
  };

  const handle = async (signal) => {
    if (signal.kind === 'answer') {
      const answer = JSON.parse(signal.payload);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      for (const c of queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    } else if (signal.kind === 'ice') {
      const c = JSON.parse(signal.payload);
      if (!c.candidate) return;
      if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => {});
      else queued.push(c);
    } else if (signal.kind === 'bye') {
      onState('closed');
    }
  };

  return {
    async start() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await post('offer', { type: 'offer', sdp: offer.sdp });
      polling = true;
      pollSignals(() => open && polling && pc.connectionState !== 'closed', take, handle);
    },
    close({ tell = true } = {}) {
      if (!open) return;
      open = false;
      polling = false;
      if (tell) post('bye', '').catch(() => {});
      try {
        channel.close();
        pc.close();
      } catch {
        // Already closed.
      }
    },
  };
}

// The watched device: it answers an offer with its camera.
//   getStream() → the camera's MediaStream or null (the offer waits until there is one).
//   post(kind, payload) sends a message to the screen; take() → { signals } waiting for this device.
//   onState(state) of the connection.
export function createTargetRtc({ iceServers, getStream, post, take, onState }) {
  let pc = null;
  let channel = null;
  let open = true;
  let queued = [];
  let waitingOffer = null;

  const closePc = () => {
    try {
      channel?.close();
      pc?.close();
    } catch {
      // Already closed.
    }
    pc = null;
    channel = null;
    queued = [];
  };

  async function answerOffer(offer) {
    const stream = getStream();
    if (!stream) return false; // the camera is not on yet: tried again on the next round
    closePc();
    const connection = new RTCPeerConnection({ iceServers });
    pc = connection;
    for (const track of stream.getVideoTracks()) connection.addTrack(track, stream);
    connection.ondatachannel = (e) => {
      channel = e.channel;
    };
    connection.onicecandidate = (e) => post('ice', candidateJson(e.candidate)).catch(() => {});
    connection.onconnectionstatechange = () => pc === connection && onState(connection.connectionState);
    await connection.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    for (const c of queued.splice(0)) await connection.addIceCandidate(c).catch(() => {});
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await post('answer', { type: 'answer', sdp: answer.sdp });
    // Light on a modest computer: about 20 pictures a second and under 1 Mbit.
    try {
      const sender = connection.getSenders().find((s) => s.track?.kind === 'video');
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      Object.assign(params.encodings[0], { maxBitrate: 900_000, maxFramerate: 24 });
      await sender.setParameters(params);
    } catch {
      // The browser's own choice is fine.
    }
    return true;
  }

  async function handle(signal) {
    if (signal.kind === 'offer') {
      waitingOffer = JSON.parse(signal.payload);
      if (await answerOffer(waitingOffer)) waitingOffer = null;
    } else if (signal.kind === 'ice') {
      const c = JSON.parse(signal.payload);
      if (!c.candidate) return;
      if (pc?.remoteDescription) await pc.addIceCandidate(c).catch(() => {});
      else queued.push(c);
    } else if (signal.kind === 'bye') {
      waitingOffer = null;
      closePc();
      onState('closed');
    }
  }

  return {
    // Listens for offers until closed. `active()` lets the caller pause the polling while it is not needed.
    listen(active = () => true) {
      pollSignals(
        () => open,
        async () => {
          if (!active()) return { signals: [] };
          // An offer that arrived before the camera was ready is answered as soon as it is.
          if (waitingOffer && getStream()) {
            const offer = waitingOffer;
            waitingOffer = null;
            if (!(await answerOffer(offer))) waitingOffer = offer;
          }
          return take();
        },
        handle,
      );
    },
    // What the detector found, on the data channel (if it is open).
    sendMeta(meta) {
      if (channel?.readyState !== 'open') return false;
      try {
        channel.send(JSON.stringify(meta));
        return true;
      } catch {
        return false;
      }
    },
    connected: () => pc?.connectionState === 'connected',
    close() {
      open = false;
      closePc();
    },
  };
}
