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
    let model;
    try {
      model = await coco.load({ base: 'lite_mobilenet_v2', modelUrl: LOCAL_MODEL });
    } catch {
      model = await coco.load({ base: 'lite_mobilenet_v2' }); // Google's copy
    }
    await warmUp(model);
    return model;
  })().catch((err) => {
    loading = null; // a failed download may work next time
    throw err;
  });
  return loading;
}

// The first detection compiles the graphics shaders and takes seconds: do it
// now, on a blank canvas, so the first real look at the camera is already fast.
async function warmUp(model) {
  if (typeof document === 'undefined') return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    await model.detect(canvas, 1, 0.9);
  } catch {
    // The first real picture will show any problem.
  }
}

// → [{ class, score, bbox: [x, y, w, h] }] for a video or image element.
export function detectLocal(model, source, maxBoxes = 20) {
  return model.detect(source, maxBoxes, 0.35);
}

// 'webgl' (graphics chip) or 'cpu': which one the detector ended up on.
export async function localBackend() {
  return (await import('@tensorflow/tfjs-core')).getBackend();
}
