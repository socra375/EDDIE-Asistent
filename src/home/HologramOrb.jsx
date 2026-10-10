import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const TWO_PI = Math.PI * 2;

const isCalm = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isLite = () => document.documentElement.dataset.perf === 'lite';

// Fewer points/lines on weak devices (Modo ligero): same shape, less geometry.
function countsFor(lite) {
  return lite
    ? { shellRings: 20, shellArcs: 40, shellSegments: 64, shellParticles: 1200, coreParticles: 600, icoDetail: 1 }
    : { shellRings: 50, shellArcs: 100, shellSegments: 128, shellParticles: 4000, coreParticles: 2000, icoDetail: 2 };
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

// Builds the three nested layers of the hologram (outer shell, middle structure, inner
// core) exactly as designed, and returns everything the render loop and colour refresh
// need. Each material is tagged 'primary' | 'secondary' | 'core' so `retint` can recolour
// the whole thing from the orb's own core-colour setting, with no geometry rebuild.
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

  const lineMaterialBase = material('primary', THREE.LineBasicMaterial, {
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const circuitMaterial = material('secondary', THREE.LineBasicMaterial, {
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glowTexture = createGlowTexture();
  disposables.push(glowTexture);
  const particleMaterial = material('core', THREE.PointsMaterial, {
    size: 0.4,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    map: glowTexture,
    alphaTest: 0.01,
  });

  // Layer 1: outer shell (deformed rings + arcs + a dusting of particles).
  (function outerShell() {
    const group = new THREE.Group();
    const radius = 20;
    const segments = quality.shellSegments;

    for (let i = 0; i < quality.shellRings; i += 1) {
      const geometry = new THREE.BufferGeometry();
      const points = [];
      const angleOffset = Math.random() * TWO_PI;
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      for (let j = 0; j <= segments; j += 1) {
        const theta = (j / segments) * TWO_PI;
        let x = radius * Math.cos(theta);
        let y = radius * Math.sin(theta);
        const noise = 1 + Math.sin(theta * (5 + Math.random() * 15)) * 0.08;
        x *= noise;
        y *= noise;
        const point = new THREE.Vector3(x, y, 0);
        point.applyAxisAngle(axis, angleOffset);
        points.push(point);
      }
      geometry.setFromPoints(points);
      disposables.push(geometry);
      const mat = Math.random() > 0.2 ? circuitMaterial : lineMaterialBase;
      group.add(new THREE.Line(geometry, mat));
    }

    for (let i = 0; i < quality.shellArcs; i += 1) {
      const geometry = new THREE.BufferGeometry();
      const points = [];
      const startAngle = Math.random() * TWO_PI;
      const arcLength = Math.random() * Math.PI * 1.5;
      const arcRadius = radius * (0.95 + Math.random() * 0.1);
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      for (let j = 0; j <= 30; j += 1) {
        const theta = startAngle + (j / 30) * arcLength;
        const x = arcRadius * Math.cos(theta);
        const y = arcRadius * Math.sin(theta);
        const point = new THREE.Vector3(x, y, 0);
        point.applyAxisAngle(axis, 0);
        points.push(point);
      }
      geometry.setFromPoints(points);
      disposables.push(geometry);
      group.add(new THREE.Line(geometry, circuitMaterial));
    }

    const shellParticlesGeo = new THREE.BufferGeometry();
    const n = quality.shellParticles;
    const shellPosArray = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
      const r = radius * (0.9 + Math.random() * 0.2);
      const theta = Math.random() * TWO_PI;
      const phi = Math.acos(2 * Math.random() - 1);
      shellPosArray[i] = r * Math.sin(phi) * Math.cos(theta);
      shellPosArray[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      shellPosArray[i + 2] = r * Math.cos(phi);
    }
    shellParticlesGeo.setAttribute('position', new THREE.BufferAttribute(shellPosArray, 3));
    disposables.push(shellParticlesGeo);
    const shellParticleMat = material('secondary', THREE.PointsMaterial, {
      size: 0.22,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Points(shellParticlesGeo, shellParticleMat));

    hologramGroup.add(group);
    rotatingLayers.push({ obj: group, speedX: 0.002, speedY: 0.0035, speedZ: -0.0012 });
  })();

  // Layer 2: middle structure (equatorial rings + sparse icosahedron wires).
  (function middleStructure() {
    const group = new THREE.Group();
    const radius = 14;

    const ringGeo = new THREE.TorusGeometry(radius, 0.1, 8, 100);
    disposables.push(ringGeo);
    const ringMat = material('secondary', THREE.MeshBasicMaterial, {
      wireframe: true,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.rotation.x = Math.PI / 2;
    group.add(ring1);
    const ring2 = new THREE.Mesh(ringGeo, ringMat);
    ring2.rotation.y = Math.PI / 2;
    group.add(ring2);

    for (let k = 0; k < 3; k += 1) {
      const innerRadius = radius * (0.8 + k * 0.1);
      const icosahedronGeo = new THREE.IcosahedronGeometry(innerRadius, quality.icoDetail);
      const edgesGeo = new THREE.EdgesGeometry(icosahedronGeo);
      icosahedronGeo.dispose();
      const posAttribute = edgesGeo.attributes.position;
      const newPositions = [];
      for (let i = 0; i < posAttribute.count; i += 2) {
        if (Math.random() > 0.4) {
          newPositions.push(
            posAttribute.getX(i), posAttribute.getY(i), posAttribute.getZ(i),
            posAttribute.getX(i + 1), posAttribute.getY(i + 1), posAttribute.getZ(i + 1),
          );
        }
      }
      edgesGeo.dispose();
      const sparseEdgesGeo = new THREE.BufferGeometry();
      sparseEdgesGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      disposables.push(sparseEdgesGeo);
      group.add(new THREE.LineSegments(sparseEdgesGeo, lineMaterialBase));
    }

    hologramGroup.add(group);
    rotatingLayers.push({ obj: group, speedX: -0.006, speedY: 0.0022, speedZ: 0.0042 });
  })();

  // Layer 3: inner core (dense wireframe sphere + concentrated particles + fast rings).
  (function innerCore() {
    const group = new THREE.Group();
    const radius = 6;

    const coreGeo = new THREE.SphereGeometry(radius, 32, 32);
    disposables.push(coreGeo);
    const coreMat = material('core', THREE.MeshBasicMaterial, {
      wireframe: true,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
    });
    group.add(new THREE.Mesh(coreGeo, coreMat));

    const particlesGeo = new THREE.BufferGeometry();
    const n = quality.coreParticles;
    const posArray = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
      const r = radius * Math.pow(Math.random(), 1 / 3) * 1.5;
      const theta = Math.random() * TWO_PI;
      const phi = Math.acos(2 * Math.random() - 1);
      posArray[i] = r * Math.sin(phi) * Math.cos(theta);
      posArray[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      posArray[i + 2] = r * Math.cos(phi);
    }
    particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    disposables.push(particlesGeo);
    group.add(new THREE.Points(particlesGeo, particleMaterial));

    for (let i = 0; i < 3; i += 1) {
      const fastRingGeo = new THREE.TorusGeometry(radius + 2, 0.05, 4, 64);
      disposables.push(fastRingGeo);
      const fastRing = new THREE.Mesh(
        fastRingGeo,
        material('secondary', THREE.MeshBasicMaterial, { transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }),
      );
      fastRing.rotation.x = Math.random() * Math.PI;
      fastRing.rotation.y = Math.random() * Math.PI;
      group.add(fastRing);
    }

    hologramGroup.add(group);
    rotatingLayers.push({ obj: group, speedX: 0.01, speedY: -0.016, speedZ: 0.008 });
  })();

  return {
    hologramGroup,
    rotatingLayers,
    materials,
    dispose() {
      for (const d of disposables) d.dispose();
      for (const list of Object.values(materials)) for (const m of list) m.dispose();
    },
  };
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

// The exact holographic-sphere design asked for (three nested, independently spinning
// layers of lines, wireframes and glowing particles over a solid black backdrop, for the
// floating effect), ported from a static Three.js scene into this React component. No
// OrbitControls on purpose: the circle is a push-to-talk button, not something to drag or
// zoom. The only liberty taken is colour: instead of the fixed orange/gold of the original,
// each layer's tint is read from the orb's own --ring/--ring-soft custom properties, so the
// core-colour picker in Configuración → Interfaz HUD still recolours it exactly as it did
// the old ring.
export default function HologramOrb({ state }) {
  const wrapRef = useRef(null);
  const live = useRef({ state, refreshColor: () => {}, request: () => {} });

  useEffect(() => {
    live.current.state = state;
    live.current.refreshColor();
    live.current.request();
  }, [state]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const s = live.current;
    const lite = isLite();
    const { hologramGroup, rotatingLayers, materials, dispose } = buildHologram(countsFor(lite));

    const BLACK = 0x050510; // the body background of the original design: solid black (not the app's theme), for the floating effect

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(BLACK, 0.015);
    scene.add(hologramGroup);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 32);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(BLACK, 1);
    renderer.domElement.className = 'eddie-orb__canvas';
    wrap.appendChild(renderer.domElement);

    let rgb = { primary: [255, 165, 0], secondary: [255, 215, 0], core: [255, 238, 187] };
    s.refreshColor = () => {
      const host = wrap.closest('.eddie-orb') || wrap;
      const ring = resolveRgb(host, '--ring', rgb.primary);
      const ringSoft = resolveRgb(host, '--ring-soft', rgb.secondary);
      rgb = { primary: ring, secondary: ringSoft, core: mixRgb(ringSoft, [255, 255, 255], 0.55) };
      for (const m of materials.primary) m.color = toThreeColor(rgb.primary);
      for (const m of materials.secondary) m.color = toThreeColor(rgb.secondary);
      for (const m of materials.core) m.color = toThreeColor(rgb.core);
    };
    s.refreshColor();

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
          const scale = 1 + Math.sin(time * 2 + layer.speedX * 1000) * 0.02;
          layer.obj.scale.set(scale, scale, scale);
        }
        for (const m of materials.core) m.opacity = (m.userData.baseOpacity ??= m.opacity) * energy.glow;
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
      running = true;
      dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <span className="eddie-orb__ring" ref={wrapRef} aria-hidden="true" />;
}
