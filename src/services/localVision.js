// The detector that lets "Modo Vigilancia" work with no key, no quota and no
// network once it is loaded: COCO-SSD (80 kinds of object, people and animals)
// running in this browser with TensorFlow.js. The libraries and the model
// (about 18 MB, served by Eddie itself from /models/coco-ssd, with Google's
// copy as a spare) are fetched the first time the camera is turned on, never
// before, kept by the browser, and no image ever leaves the device.
const LOCAL_MODEL = '/models/coco-ssd/model.json';
let loading = null;

export function loadLocalDetector() {
  loading ||= (async () => {
    const [core, , , , coco] = await Promise.all([
      import('@tensorflow/tfjs-core'),
      import('@tensorflow/tfjs-converter'),
      import('@tensorflow/tfjs-backend-webgl'),
      import('@tensorflow/tfjs-backend-cpu'),
      import('@tensorflow-models/coco-ssd'),
    ]);
    // WebGL when the browser has it, plain CPU otherwise.
    await core.ready();
    try {
      return await coco.load({ base: 'lite_mobilenet_v2', modelUrl: LOCAL_MODEL });
    } catch {
      return coco.load({ base: 'lite_mobilenet_v2' }); // Google's copy
    }
  })().catch((err) => {
    loading = null; // a failed download may work next time
    throw err;
  });
  return loading;
}

// → [{ class, score, bbox: [x, y, w, h] }] for a video or image element.
export function detectLocal(model, source, maxBoxes = 20) {
  return model.detect(source, maxBoxes, 0.35);
}

// 'webgl' (graphics chip) or 'cpu': which one the detector ended up on.
export async function localBackend() {
  return (await import('@tensorflow/tfjs-core')).getBackend();
}
