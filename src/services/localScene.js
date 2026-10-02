// "Modo Vigilancia" without sending anything anywhere: the detector that runs
// in the browser (COCO-SSD, see localVision.js) finds objects, people and
// animals; this turns its answer into the same shape the cloud AI returns
// ({ summary, objects: [{ label, category, count, confidence, box, ... }] }),
// so the list, the boxes, the log and the spoken alerts work the same.
// Pure (no browser APIs), so it can be tested in Node.

// COCO class → Spanish label.
export const SPANISH = {
  person: 'persona', bicycle: 'bicicleta', car: 'auto', motorcycle: 'moto', airplane: 'avión', bus: 'autobús', train: 'tren', truck: 'camión', boat: 'bote',
  'traffic light': 'semáforo', 'fire hydrant': 'hidrante', 'stop sign': 'señal de alto', 'parking meter': 'parquímetro', bench: 'banco', bird: 'pájaro',
  cat: 'gato', dog: 'perro', horse: 'caballo', sheep: 'oveja', cow: 'vaca', elephant: 'elefante', bear: 'oso', zebra: 'cebra', giraffe: 'jirafa',
  backpack: 'mochila', umbrella: 'paraguas', handbag: 'bolso', tie: 'corbata', suitcase: 'maleta', frisbee: 'frisbee', skis: 'esquís',
  snowboard: 'tabla de snowboard', 'sports ball': 'pelota', kite: 'cometa', 'baseball bat': 'bate', 'baseball glove': 'guante de béisbol', skateboard: 'patineta',
  surfboard: 'tabla de surf', 'tennis racket': 'raqueta', bottle: 'botella', 'wine glass': 'copa', cup: 'taza', fork: 'tenedor', knife: 'cuchillo', spoon: 'cuchara',
  bowl: 'tazón', banana: 'banana', apple: 'manzana', sandwich: 'sándwich', orange: 'naranja', broccoli: 'brócoli', carrot: 'zanahoria', 'hot dog': 'perro caliente',
  pizza: 'pizza', donut: 'dona', cake: 'pastel', chair: 'silla', couch: 'sofá', 'potted plant': 'planta', bed: 'cama', 'dining table': 'mesa', toilet: 'inodoro',
  tv: 'televisor', laptop: 'laptop', mouse: 'mouse', remote: 'control remoto', keyboard: 'teclado', 'cell phone': 'celular', microwave: 'microondas', oven: 'horno',
  toaster: 'tostadora', sink: 'lavabo', refrigerator: 'nevera', book: 'libro', clock: 'reloj', vase: 'jarrón', scissors: 'tijeras', 'teddy bear': 'oso de peluche',
  'hair drier': 'secador de pelo', toothbrush: 'cepillo de dientes',
};

const ANIMALS = new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']);
const VEHICLES = new Set(['bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat']);

// What a thing is usually made of: only a hint, shown as "probable".
const MATERIALS = {
  'wine glass': 'vidrio', bottle: 'vidrio o plástico', cup: 'cerámica', bowl: 'cerámica', vase: 'cerámica o vidrio', book: 'papel', clock: 'plástico o metal',
  fork: 'metal', knife: 'metal', spoon: 'metal', scissors: 'metal', chair: 'madera o plástico', 'dining table': 'madera', bed: 'tela', couch: 'tela',
  backpack: 'tela', handbag: 'cuero o tela', suitcase: 'plástico o tela', 'teddy bear': 'tela', tv: 'plástico y vidrio', laptop: 'plástico y metal',
  'cell phone': 'vidrio y metal', keyboard: 'plástico', mouse: 'plástico', 'potted plant': 'planta', umbrella: 'tela',
};

const MIN_SCORE = 0.45;
const MAX_OBJECTS = 12;

export const categoryOf = (cls) => (cls === 'person' ? 'persona' : ANIMALS.has(cls) ? 'animal' : VEHICLES.has(cls) ? 'vehículo' : 'objeto');

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Detector box [x, y, width, height] in pixels → [ymin, xmin, ymax, xmax] on a 0–1000 scale.
export function toBox(bbox, width, height) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !(width > 0) || !(height > 0)) return undefined;
  const [x, y, w, h] = bbox.map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return undefined;
  const box = [(y / height) * 1000, (x / width) * 1000, ((y + h) / height) * 1000, ((x + w) / width) * 1000].map((v) => clamp(Math.round(v), 0, 1000));
  return box[2] - box[0] >= 5 && box[3] - box[1] >= 5 ? box : undefined;
}

// predictions: [{ class, score, bbox: [x, y, w, h] }] → { summary, objects }.
// The same kind of thing is grouped (count) and keeps the box of its best match.
export function sceneFromPredictions(predictions, width, height, { minScore = MIN_SCORE } = {}) {
  const groups = new Map();
  for (const p of Array.isArray(predictions) ? predictions : []) {
    if (!p || typeof p.class !== 'string' || !(p.score >= minScore)) continue;
    const g = groups.get(p.class) || { cls: p.class, count: 0, best: p };
    g.count += 1;
    if (p.score > g.best.score) g.best = p;
    groups.set(p.class, g);
  }
  const rank = { persona: 0, animal: 1, vehículo: 2, objeto: 3 };
  const objects = [...groups.values()]
    .map((g) => {
      const category = categoryOf(g.cls);
      const object = { label: SPANISH[g.cls] || g.cls.slice(0, 40), category, count: g.count, confidence: Math.round(g.best.score * 100) / 100 };
      if (MATERIALS[g.cls]) {
        object.material = MATERIALS[g.cls];
        object.detail = 'material probable';
      }
      const box = toBox(g.best.bbox, width, height);
      if (box) object.box = box;
      return object;
    })
    .sort((a, b) => rank[a.category] - rank[b.category] || b.confidence - a.confidence)
    .slice(0, MAX_OBJECTS);
  return { summary: summarize(objects), objects };
}

// "persona" → "personas", "celular" → "celulares", "camión" → "camiones",
// "laptop" → "laptops", "señal de alto" → "señales de alto".
const PLAIN = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' };
export function plural(label, count) {
  if (count === 1) return label;
  const [first, ...rest] = label.split(' ');
  let many;
  if (/[aeiouáéíóú]$/.test(first)) many = `${first}s`;
  else if (/z$/.test(first)) many = `${first.slice(0, -1)}ces`;
  else if (/[áéíóú][ns]$/.test(first)) many = `${first.replace(/[áéíóú]/, (v) => PLAIN[v])}es`; // camión, autobús
  else if (/[sx]$/.test(first)) many = first; // lunes
  else if (/[ptkf]$/.test(first)) many = `${first}s`; // laptop, set
  else many = `${first}es`;
  return [many, ...rest].join(' ');
}

function listOf(objects) {
  const parts = objects.map((o) => `${o.count} ${plural(o.label, o.count)}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0] || '';
}

function summarize(objects) {
  return objects.length ? `Veo ${listOf(objects)}.` : 'No distingo nada claro en la imagen.';
}

// What Eddie answers to "¿qué ves?": the detector's list, plus the cloud AI's
// description when it has one.
export function describeScene(scene) {
  if (!scene || (!scene.objects?.length && !scene.summary)) return 'Todavía no distingo nada claro. Dame unos segundos o acércame algo a la cámara.';
  const parts = [];
  if (scene.provider && scene.provider !== 'local' && scene.summary && !/^Veo \d/.test(scene.summary)) parts.push(scene.summary);
  const base = scene.objects?.length ? `Veo ${listOf(scene.objects)}.` : '';
  if (base) parts.push(base);
  const materials = (scene.objects || []).filter((o) => o.material).slice(0, 3);
  if (materials.length) parts.push(`Por su aspecto, ${materials.map((o) => `${o.label}: ${o.material}`).join('; ')} (material probable).`);
  return parts.join(' ') || scene.summary;
}
