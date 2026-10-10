import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const TWO_PI = Math.PI * 2;

const isCalm = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isLite = () => document.documentElement.dataset.perf === 'lite';

// Fewer points/bands on weak devices (Modo ligero): same shape, less geometry.
function countsFor(lite) {
  return lite
    ? { bands: 6, bandParticles: 90, filaments: 5, filamentSegments: 48, hazeParticles: 1000, coreParticles: 220 }
    : { bands: 12, bandParticles: 190, filaments: 10, filamentSegments: 96, hazeParticles: 2600, coreParticles: 550 };
}

// The colour a CSS custom property resolves to, as "r,g,b" (a throw-away element lets the browser do the work).
function resolveRgb(host, varName, fallback) {
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${varName})`;
  host.appendChild(probe);
  const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(getComputedStyle(probe).color || '');
  probe.remove();
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

const mixRgb = (rgb, target, amount) => rgb.map((c, i) => c + (target[i] - c) * amount);
const toThreeColor = (rgb) => new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

// Jarvis-style mood palette: cyan/the user's own colour at rest, violet while it works
// something out, red-orange on a warning or error (see the HUD spec this was asked to
// follow). `user` is the orb's own --ring/--ring-soft (the core-colour picker in
// Configuración still controls the resting colour).
function paletteFor(state, user) {
  if (state === 'processing') return { primary: [168, 85, 247], secondary: [205, 160, 255] };
  if (state === 'error') return { primary: [255, 73, 46], secondary: [255, 170, 90] };
  return user;
}

// A soft round dot, white with a fading edge: the colour comes from each material's own
// tint (set in retint), not from the texture, so recolouring never needs a new texture.
function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function randomAxis() {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
}

// Builds the hologram: a bright glassy core, a swirl of independently orbiting particle
// bands (the "particle matrix"), a few thin neon filaments threading through them, and an
// outer haze for depth. Every material is tagged 'primary' | 'secondary' | 'core' so
// `retint` can recolour (and, per state, repaint the mood colour over) the whole thing
// with no geometry rebuild.
function buildHologram(quality) {
  const hologramGroup = new THREE.Group();
  const rotatingLayers = [];
  const materials = { primary: [], secondary: [], core: [] };
  const disposables = []; // geometries + textures, disposed on unmount

  function material(kind, Ctor, opts) {
    const mat = new Ctor(opts);
    materials[kind].push(mat);
    return mat;
  }

  // Layer 1: the orbital particle bands — thin rings of light at random tilts and radii,
  // each spinning at its own speed so they interlace instead of all turning together.
  for (let i = 0; i < quality.bands; i += 1) {
    const radius = 9 + Math.random() * 9;
    const axis = randomAxis();
    const tilt = Math.random() * TWO_PI;
    const n = quality.bandParticles;
    const pos = new Float32Array(n * 3);
    for (let j = 0; j < n; j += 1) {
      const theta = (j / n) * TWO_PI + Math.random() * 0.25;
      const wobble = radius * (1 + (Math.random() - 0.5) * 0.1);
      const p = new THREE.Vector3(wobble * Math.cos(theta), wobble * Math.sin(theta), (Math.random() - 0.5) * radius * 0.06);
      p.applyAxisAngle(axis, tilt);
      pos[j * 3] = p.x;
      pos[j * 3 + 1] = p.y;
      pos[j * 3 + 2] = p.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    disposables.push(geo);
    const mat = material(i % 3 === 0 ? 'primary' : 'secondary', THREE.PointsMaterial, {
      size: 0.32 + Math.random() * 0.22,
      transparent: true,
      opacity: 0.55 + Math.random() * 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    hologramGroup.add(points);
    const dir = Math.random() > 0.5 ? 1 : -1;
    const speed = (0.0015 + Math.random() * 0.004) * dir;
    rotatingLayers.push({ obj: points, speedX: speed * 0.6, speedY: speed, speedZ: speed * 0.3 });
  }

  // Layer 2: a handful of thin spiral filaments (the "neon thread" accents) — structure
  // enough to read as a sphere, without going back to a geometric wireframe ball.
  for (let i = 0; i < quality.filaments; i += 1) {
    const radius = 11 + Math.random() * 7;
    const axis = randomAxis();
    const tilt = Math.random() * TWO_PI;
    const turns = 2 + Math.random() * 3;
    const segs = quality.filamentSegments;
    const points = [];
    for (let j = 0; j <= segs; j += 1) {
      const t = j / segs;
      const theta = t * TWO_PI * turns;
      const phi = Math.PI * t;
      const p = new THREE.Vector3(radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi) * 0.9);
      p.applyAxisAngle(axis, tilt);
      points.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    disposables.push(geo);
    const mat = material(i % 2 === 0 ? 'primary' : 'secondary', THREE.LineBasicMaterial, {
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    hologramGroup.add(line);
    const dir = Math.random() > 0.5 ? 1 : -1;
    rotatingLayers.push({ obj: line, speedX: 0.0008 * dir, speedY: 0.0014 * -dir, speedZ: 0.0006 * dir });
  }

  // Layer 3: outer haze — a sparse, large dust cloud for depth and particle count, the
  // dimmest layer so the bands and filaments keep reading as the main shape.
  (function outerHaze() {
    const radius = 19;
    const n = quality.hazeParticles;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
      const r = radius * (0.75 + Math.random() * 0.3);
      const theta = Math.random() * TWO_PI;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i] = r * Math.sin(phi) * Math.cos(theta);
      pos[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    disposables.push(geo);
    const mat = material('secondary', THREE.PointsMaterial, { size: 0.16, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    hologramGroup.add(points);
    rotatingLayers.push({ obj: points, speedX: 0.0004, speedY: 0.0007, speedZ: -0.0003 });
  })();

  // Layer 4: the glassy core — a billboard glow (always facing the camera, so it reads as
  // a bright solid lens rather than a flat disc) plus a tight cluster of particles.
  const glowTexture = createGlowTexture();
  disposables.push(glowTexture);
  const coreSpriteMat = material('core', THREE.SpriteMaterial, { map: glowTexture, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const coreSprite = new THREE.Sprite(coreSpriteMat);
  coreSprite.scale.set(11, 11, 1);
  hologramGroup.add(coreSprite);

  (function coreCluster() {
    const radius = 5;
    const n = quality.coreParticles;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
      const r = radius * Math.pow(Math.random(), 1 / 3);
      const theta = Math.random() * TWO_PI;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i] = r * Math.sin(phi) * Math.cos(theta);
      pos[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    disposables.push(geo);
    const mat = material('core', THREE.PointsMaterial, { size: 0.4, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture, alphaTest: 0.01 });
    const points = new THREE.Points(geo, mat);
    hologramGroup.add(points);
    rotatingLayers.push({ obj: points, speedX: 0.01, speedY: -0.016, speedZ: 0.008 });
  })();

  return {
    hologramGroup,
    rotatingLayers,
    coreSprite,
    materials,
    dispose() {
      for (const d of disposables) d.dispose();
      for (const list of Object.values(materials)) for (const m of list) m.dispose();
    },
  };
}

// A one-shot expanding shockwave (a thin ring that grows and fades): the "blown out"
// pulse the orb gives when it starts listening or starts working something out.
function buildBurst() {
  const geo = new THREE.RingGeometry(0.92, 1, 64);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(6);
  return { mesh, geo, mat, t: 1 }; // t >= 1: finished/idle
}

// How quickly the hologram spins and how brightly its core glows, per push-to-talk state.
function energyFor(state) {
  switch (state) {
    case 'listening':
    case 'speaking':
      return { speed: 1.6, glow: 1.15 };
    case 'processing':
      return { speed: 2.2, glow: 1.3 };
    case 'disabled':
      return { speed: 0.25, glow: 0.5 };
    case 'error':
      return { speed: 1, glow: 1 };
    default:
      return { speed: 1, glow: 1 };
  }
}

// The states that fire the activation pulse: the moment the orb starts listening (it
// just "received a command") or starts working something out ("interpreting" it).
const BURST_STATES = new Set(['listening', 'processing']);

// A Jarvis-style holographic orb: a glassy core inside a swirl of independently orbiting
// particle bands and a few neon filaments, over a solid black backdrop (the floating
// effect). No OrbitControls on purpose: the circle is a push-to-talk button, not
// something to drag or zoom. Colour is reactive, not fixed: cyan (or whatever the core-
// colour picker in Configuración → Interfaz HUD is set to) at rest, violet while
// thinking, red-orange on an error — with a one-shot pulse when it starts listening or
// processing. (Two things from the brief this does NOT do yet, for lack of a real event
// to hook them to: particles "absorbing" into the core on saving a memory, and the orb
// splitting into sub-orbs while delegating a subtask.)
export default function HologramOrb({ state }) {
  const wrapRef = useRef(null);
  const live = useRef({ state, refreshColor: () => {}, request: () => {}, triggerBurst: () => {} });

  useEffect(() => {
    const prev = live.current.state;
    live.current.state = state;
    live.current.refreshColor();
    if (state !== prev && BURST_STATES.has(state) && !BURST_STATES.has(prev)) live.current.triggerBurst();
    live.current.request();
  }, [state]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const s = live.current;
    const lite = isLite();
    const { hologramGroup, rotatingLayers, coreSprite, materials, dispose } = buildHologram(countsFor(lite));
    const burst = buildBurst();

    const BLACK = 0x050510; // solid black (not the app's theme), for the floating effect

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(BLACK, 0.015);
    scene.add(hologramGroup);
    scene.add(burst.mesh);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 32);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(BLACK, 1);
    renderer.domElement.className = 'eddie-orb__canvas';
    wrap.appendChild(renderer.domElement);

    let userRgb = { primary: [63, 232, 255], secondary: [185, 247, 255] };
    let rgb = userRgb;
    s.refreshColor = () => {
      const host = wrap.closest('.eddie-orb') || wrap;
      userRgb = { primary: resolveRgb(host, '--ring', userRgb.primary), secondary: resolveRgb(host, '--ring-soft', userRgb.secondary) };
      const mood = paletteFor(s.state, userRgb);
      rgb = { primary: mood.primary, secondary: mood.secondary, core: mixRgb(mood.secondary, [255, 255, 255], 0.55) };
      for (const m of materials.primary) m.color = toThreeColor(rgb.primary);
      for (const m of materials.secondary) m.color = toThreeColor(rgb.secondary);
      for (const m of materials.core) m.color = toThreeColor(rgb.core);
      burst.mat.color = toThreeColor(rgb.primary);
    };
    s.refreshColor();

    s.triggerBurst = () => {
      burst.t = 0;
    };

    let running = false;
    let visible = true;
    let time = 0;
    let energy = energyFor(s.state);
    let lastEnergy = energy;

    function resize() {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight || w;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    }

    function render() {
      renderer.render(scene, camera);
    }

    function frame() {
      running = false;
      const calm = isCalm();
      const target = energyFor(s.state);
      lastEnergy = { speed: lastEnergy.speed + (target.speed - lastEnergy.speed) * 0.08, glow: lastEnergy.glow + (target.glow - lastEnergy.glow) * 0.08 };
      energy = lastEnergy;
      const animating = !calm && visible && !document.hidden;
      if (animating) {
        const dt = 0.034 * energy.speed;
        time += dt;
        hologramGroup.position.y = Math.sin(time) * 1.5;
        hologramGroup.rotation.x += 0.0016 * energy.speed;
        hologramGroup.rotation.y += 0.0032 * energy.speed;
        hologramGroup.rotation.z = Math.sin(time * 0.5) * 0.08;
        for (const layer of rotatingLayers) {
          layer.obj.rotation.x += layer.speedX * energy.speed;
          layer.obj.rotation.y += layer.speedY * energy.speed;
          layer.obj.rotation.z += layer.speedZ * energy.speed;
        }
        // The core glow breathes with a slow pulse at rest, and brighter/faster per state;
        // on an error it flashes instead of breathing.
        const flash = s.state === 'error' ? 0.65 + 0.35 * Math.abs(Math.sin(time * 9)) : 0.85 + 0.15 * Math.sin(time * 1.6);
        coreSprite.scale.setScalar(11 * (0.92 + 0.08 * flash));
        for (const m of materials.core) m.opacity = (m.userData.baseOpacity ??= m.opacity) * energy.glow * flash;
        // The activation pulse: a ring expanding outward from the core while it fades.
        if (burst.t < 1) {
          burst.t = Math.min(1, burst.t + dt * 1.1);
          burst.mesh.scale.setScalar(6 + burst.t * 24);
          burst.mat.opacity = (1 - burst.t) * 0.8;
        } else if (burst.mat.opacity !== 0) {
          burst.mat.opacity = 0;
        }
      }
      render();
      if (animating) request();
    }

    function request() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    }
    s.request = request;

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) request();
    });
    seen.observe(wrap);
    const mode = new MutationObserver(() => {
      s.refreshColor();
      request();
    });
    mode.observe(document.documentElement, { attributes: true, attributeFilter: ['data-core', 'data-theme', 'data-perf'] });
    const onVisibility = () => !document.hidden && request();
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    request();

    return () => {
      observer.disconnect();
      seen.disconnect();
      mode.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      s.request = () => {};
      s.triggerBurst = () => {};
      running = true;
      dispose();
      burst.geo.dispose();
      burst.mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <span className="eddie-orb__ring" ref={wrapRef} aria-hidden="true" />;
}
