// Browser side of Modo Vigilancia: opening the camera and taking pictures
// from it. Nothing here is ever stored; frames go to the AI and are dropped.
import { MOTION_H, MOTION_W } from './vigilance';

export const CONSENT_KEY = 'eddie.vision.consent';
const SEND_SIDE = 640;
const SEND_QUALITY = 0.7;
const THUMB_SIDE = 160;

export function cameraSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function readConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, '1');
  } catch {
    // Without storage the permission is asked again next time.
  }
}

// What went wrong opening the camera, in words for the user.
export function describeCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'El navegador no dio permiso para usar la cámara. Actívalo en el candado de la barra de direcciones y vuelve a intentarlo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No encontré ninguna cámara en este equipo.';
    case 'NotReadableError':
      return 'La cámara está siendo usada por otra aplicación.';
    default:
      return 'No pude abrir la cámara.';
  }
}

export async function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

// A <video> element that only exists to be drawn from.
export function createFeedVideo(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  return video;
}

const ready = (video) => video.readyState >= 2 && video.videoWidth > 0;

// The frame as 32×24 grey values, to tell whether the scene moved.
export function captureGray(video, canvas = document.createElement('canvas')) {
  if (!ready(video)) return null;
  canvas.width = MOTION_W;
  canvas.height = MOTION_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, MOTION_W, MOTION_H);
  const { data } = ctx.getImageData(0, 0, MOTION_W, MOTION_H);
  const gray = new Uint8Array(MOTION_W * MOTION_H);
  for (let i = 0; i < gray.length; i += 1) gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  return gray;
}

function jpeg(video, side, quality) {
  const scale = Math.min(1, side / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

const base64Of = (dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1);

// The frame to send: { mimeType, data (base64), thumb (data URL), name }.
export function captureFrame(video, { withThumb = false } = {}) {
  if (!ready(video)) return null;
  const frame = { mimeType: 'image/jpeg', data: base64Of(jpeg(video, SEND_SIDE, SEND_QUALITY)), name: 'cámara.jpg' };
  if (withThumb) frame.thumb = jpeg(video, THUMB_SIDE, 0.6);
  return frame;
}
