import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { projectUrl } from '../services/construction3d';

// One project in 3D. "Holograma": the model's edges in cyan plus a translucent
// shell that glows at its rim and is crossed by moving scan lines, over a base
// of amber rings, all on black. "Original": the model as it was exported.
// Drag to turn it, wheel or pinch to zoom.
const CYAN = 0x3fe8ff;
const AMBER = 0xffb020;
const ICE = 0xbff6ff;

const SHELL_VERTEX = `
  varying vec3 vNormal; varying vec3 vView; varying float vHeight;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 view = viewMatrix * world;
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-view.xyz);
    vHeight = world.y;
    gl_Position = projectionMatrix * view;
  }`;
const SHELL_FRAGMENT = `
  uniform vec3 uColor; uniform float uTime;
  varying vec3 vNormal; varying vec3 vView; varying float vHeight;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
    float lines = 0.5 + 0.5 * sin(vHeight * 38.0 - uTime * 2.4);
    float alpha = 0.09 + rim * 0.6 + lines * 0.12 * (0.4 + rim);
    gl_FragColor = vec4(uColor, alpha);
  }`;

function ring(radius, color, opacity, dashed) {
  const pts = [];
  for (let i = 0; i < 128; i += 1) pts.push(new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * radius, 0, Math.sin((i / 128) * Math.PI * 2) * radius));
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const options = { color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false };
  const line = new THREE.LineLoop(geometry, dashed ? new THREE.LineDashedMaterial({ ...options, dashSize: radius * 0.06, gapSize: radius * 0.04 }) : new THREE.LineBasicMaterial(options));
  if (dashed) line.computeLineDistances();
  return line;
}

async function download(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar el modelo (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body?.getReader) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total) onProgress(loaded / total);
  }
  const all = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all.buffer;
}

const parseGlb = (buffer) => new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));

// Whatever the format, the model comes back as one object to hold and frame.
async function loadModel(format, buffer) {
  if (format === 'stl') {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xaab4c0, metalness: 0.2, roughness: 0.5 });
    group.add(new THREE.Mesh(new STLLoader().parse(buffer), material));
    return group;
  }
  if (format === 'obj') return new OBJLoader().parse(new TextDecoder().decode(buffer));
  return (await parseGlb(buffer)).scene;
}

export default function ModelViewer({ projectId, mode }) {
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const modeRef = useRef(mode);
  const [view, setView] = useState({ status: 'loading', progress: 0, error: '' });

  useEffect(() => {
    const host = hostRef.current;
    const lite = document.documentElement.dataset.perf === 'lite';
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let alive = true;
    let raf = 0;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !lite, alpha: true });
    } catch {
      queueMicrotask(() => setView({ status: 'error', progress: 0, error: 'Este dispositivo no permite gráficos 3D (WebGL).' }));
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1 : 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'c3d-canvas';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 1.1;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    scene.add(sun);

    const fit = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();

    const owned = []; // geometries, materials and textures this viewer made or loaded
    const shellUniforms = { uColor: { value: new THREE.Color(CYAN) }, uTime: { value: 0 } };
    const meshes = [];
    const extras = new THREE.Group(); // everything holographic that is not the model
    scene.add(extras);
    let sweep = null;
    let sweepRange = [0, 1];

    const applyMode = (next) => {
      const holo = next !== 'original';
      for (const m of meshes) {
        m.mesh.material = holo ? m.hidden : m.original;
        for (const child of m.holo) child.visible = holo;
      }
      extras.visible = holo;
    };

    (async () => {
      try {
        const { url, format } = await projectUrl(projectId);
        const buffer = await download(url, (progress) => alive && setView((v) => ({ ...v, progress })));
        const model = await loadModel(format, buffer);
        if (!alive) return;
        const shell = new THREE.ShaderMaterial({ uniforms: shellUniforms, vertexShader: SHELL_VERTEX, fragmentShader: SHELL_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        const edgeMaterial = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
        const hidden = new THREE.MeshBasicMaterial({ visible: false });
        owned.push(shell, edgeMaterial, hidden);
        const found = [];
        model.traverse((node) => node.isMesh && found.push(node)); // collected first: adding children while walking would revisit them
        for (const node of found) {
          const holo = [];
          // Hard edges for models with crisp parts; a smooth model has none, so it gets its wireframe instead.
          let lines = new THREE.EdgesGeometry(node.geometry, 14);
          if (lines.attributes.position.count < 600) {
            lines.dispose();
            lines = new THREE.WireframeGeometry(node.geometry);
          }
          const edges = new THREE.LineSegments(lines, edgeMaterial);
          owned.push(lines);
          holo.push(edges);
          if (!lite) holo.push(new THREE.Mesh(node.geometry, shell));
          node.add(...holo);
          meshes.push({ mesh: node, original: node.material, hidden, holo });
        }
        scene.add(model);

        // centre it, make it a known size, and frame it
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const scale = 2.4 / (Math.max(size.x, size.y, size.z) || 1);
        model.scale.setScalar(scale);
        model.position.sub(centre.multiplyScalar(scale));
        const half = size.multiplyScalar(scale).multiplyScalar(0.5);
        const reach = Math.max(half.x, half.z, 0.8);
        camera.position.set(reach * 2.4, half.y * 0.9 + 0.5, reach * 3.4);
        controls.target.set(0, 0, 0);
        controls.minDistance = 0.8;
        controls.maxDistance = 14;
        controls.update();

        // base rings and a scan ring crossing the model's height
        const floor = -half.y - 0.05;
        for (const [factor, color, opacity, dashed] of [[1.25, AMBER, 0.8, true], [1.6, CYAN, 0.35, false], [2, AMBER, 0.4, true]]) {
          const base = ring(reach * factor, color, opacity, dashed);
          base.position.y = floor;
          extras.add(base);
          owned.push(base.geometry, base.material);
        }
        sweep = ring(reach * 1.1, ICE, 0.6, false);
        extras.add(sweep);
        owned.push(sweep.geometry, sweep.material);
        sweepRange = [floor, half.y];

        applyMode(modeRef.current);
        for (const m of meshes) owned.push(m.mesh.geometry);
        setView({ status: 'ready', progress: 1, error: '' });
      } catch (err) {
        if (!alive) return;
        const compressed = /draco|meshopt/i.test(err?.message || '');
        setView({ status: 'error', progress: 0, error: compressed ? 'Este modelo viene comprimido (Draco/Meshopt). Expórtalo desde Blender sin compresión.' : err?.message || 'No se pudo abrir el modelo.' });
      }
    })();
    apiRef.current = { applyMode };

    const clock = new THREE.Clock();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const time = clock.getElapsedTime();
      shellUniforms.uTime.value = time;
      if (sweep) sweep.position.y = sweepRange[0] + (sweepRange[1] - sweepRange[0]) * (0.5 + 0.5 * Math.sin(time * 0.9));
      extras.rotation.y = still ? 0 : time * 0.12;
      controls.update();
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      apiRef.current = null;
      const textures = new Set();
      for (const m of meshes) for (const value of Object.values(m.original)) if (value?.isTexture) textures.add(value);
      for (const item of new Set([...owned, ...meshes.map((m) => m.original), ...textures])) item?.dispose?.();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [projectId]);

  useEffect(() => {
    modeRef.current = mode;
    apiRef.current?.applyMode(mode);
  }, [mode]);

  return (
    <div className="c3d-viewer" ref={hostRef}>
      {view.status === 'loading' && (
        <div className="c3d-viewer__note" role="status">
          <span className="c3d-viewer__spin" />
          <span>Cargando modelo{view.progress > 0 ? ` · ${Math.round(view.progress * 100)}%` : '…'}</span>
        </div>
      )}
      {view.status === 'error' && (
        <div className="c3d-viewer__note c3d-viewer__note--bad" role="alert">
          {view.error}
        </div>
      )}
    </div>
  );
}
