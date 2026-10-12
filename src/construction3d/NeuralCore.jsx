import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// The 3D brain's centrepiece: a holographic brain made of points and a
// neighbour mesh, data pulses running along its synapses, amber orbital rings
// and, around it, one small wireframe satellite per project, linked to the
// brain by a thin line a pulse travels along. Terminado = cyan, en proceso =
// amber. Everything is generated here (no model file); the satellites are
// stand-ins — the real model opens in ModelViewer when one is chosen.
const CYAN = 0x3fe8ff;
const ICE = 0xbff6ff;
const AMBER = 0xffb020;
const MAX_SATELLITES = 8;
const SHAPES = ['icosa', 'box', 'octa', 'dodeca', 'knot'];

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const fold = (x, y, z) => Math.sin(x * 9 + Math.sin(y * 7)) * 0.5 + Math.sin(y * 11 + z * 6) * 0.3 + Math.sin(z * 13 - x * 5) * 0.2;

// Two hemispheres, a cerebellum and a stem: points on folded ellipsoids.
function brainPoints(count) {
  const rand = rng(7);
  const parts = [
    { c: [-0.21, 0.03, 0.02], r: [0.4, 0.43, 0.64], w: 0.45 },
    { c: [0.21, 0.03, 0.02], r: [0.4, 0.43, 0.64], w: 0.45 },
    { c: [0, -0.3, -0.42], r: [0.27, 0.15, 0.21], w: 0.07 },
    { c: [0, -0.42, -0.18], r: [0.07, 0.22, 0.07], w: 0.03 },
  ];
  const out = [];
  for (const { c, r, w } of parts) {
    const n = Math.round(count * w);
    for (let i = 0; i < n; i += 1) {
      let x = gauss(rand);
      let y = gauss(rand);
      let z = gauss(rand);
      const len = Math.hypot(x, y, z) || 1;
      x /= len;
      y /= len;
      z /= len;
      const inner = rand() < 0.14 ? 0.55 + rand() * 0.4 : 1;
      let px = c[0] + x * r[0] * inner;
      let py = c[1] + y * r[1] * inner;
      let pz = c[2] + z * r[2] * inner;
      const f = 1 + 0.07 * fold(px, py, pz) * (inner === 1 ? 1 : 0.4);
      px = c[0] + (px - c[0]) * f;
      py = c[1] + (py - c[1]) * f;
      pz = c[2] + (pz - c[2]) * f;
      const floor = c[1] - r[1] * 0.45;
      if (py < floor) py = floor + (py - floor) * 0.35;
      out.push(px, py, pz);
    }
  }
  return new Float32Array(out);
}

// Each point to its nearest neighbours (a spatial hash keeps it cheap).
function neighbourEdges(pos, perPoint, maxDist) {
  const n = pos.length / 3;
  const cell = maxDist;
  const grid = new Map();
  const cellOf = (v) => Math.floor(v / cell);
  for (let i = 0; i < n; i += 1) {
    const key = `${cellOf(pos[i * 3])},${cellOf(pos[i * 3 + 1])},${cellOf(pos[i * 3 + 2])}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  const seen = new Set();
  const edges = [];
  const max2 = maxDist * maxDist;
  for (let i = 0; i < n; i += 1) {
    const cx = cellOf(pos[i * 3]);
    const cy = cellOf(pos[i * 3 + 1]);
    const cz = cellOf(pos[i * 3 + 2]);
    const near = [];
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1)
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
            if (j === i) continue;
            const d2 = (pos[i * 3] - pos[j * 3]) ** 2 + (pos[i * 3 + 1] - pos[j * 3 + 1]) ** 2 + (pos[i * 3 + 2] - pos[j * 3 + 2]) ** 2;
            if (d2 < max2) near.push([d2, j]);
          }
    near.sort((p, q) => p[0] - q[0]);
    for (const [, j] of near.slice(0, perPoint)) {
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = a * n + b;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  }
  return edges;
}

function softDot() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function circle(radius, segments = 128) {
  const pts = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function shapeGeometry(kind) {
  if (kind === 'box') return new THREE.BoxGeometry(1, 1, 1);
  if (kind === 'octa') return new THREE.OctahedronGeometry(0.75);
  if (kind === 'dodeca') return new THREE.DodecahedronGeometry(0.7);
  if (kind === 'knot') return new THREE.TorusKnotGeometry(0.5, 0.17, 64, 8);
  return new THREE.IcosahedronGeometry(0.75, 0);
}

const hashOf = (text) => [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

export default function NeuralCore({ projects, activeId, onSelect, onUnsupported }) {
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const latest = useRef({ projects, activeId, onSelect, onUnsupported });
  useEffect(() => {
    latest.current = { projects, activeId, onSelect, onUnsupported };
  });

  useEffect(() => {
    const host = hostRef.current;
    const lite = document.documentElement.dataset.perf === 'lite';
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !lite, alpha: true, powerPreference: 'high-performance' });
    } catch {
      latest.current.onUnsupported?.();
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1 : 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.className = 'c3d-canvas';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
    const disposables = [];
    const track = (item) => {
      disposables.push(item);
      return item;
    };
    const dot = track(softDot());
    const add = THREE.AdditiveBlending;

    const root = new THREE.Group();
    scene.add(root);

    // --- the brain
    const brain = new THREE.Group();
    brain.scale.setScalar(2);
    root.add(brain);
    const pos = brainPoints(lite ? 900 : 1700);
    const count = pos.length / 3;
    const pointGeo = track(new THREE.BufferGeometry());
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rand = rng(21);
    const colors = new Float32Array(count * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      tint.set(rand() < 0.06 ? AMBER : rand() < 0.3 ? ICE : CYAN);
      colors.set([tint.r, tint.g, tint.b], i * 3);
    }
    pointGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    brain.add(new THREE.Points(pointGeo, track(new THREE.PointsMaterial({ size: 0.024, map: dot, vertexColors: true, transparent: true, blending: add, depthWrite: false }))));

    const edges = neighbourEdges(pos, lite ? 2 : 3, 0.105);
    const edgeCount = edges.length / 2;
    const lineGeo = track(new THREE.BufferGeometry());
    const lineArr = new Float32Array(edgeCount * 6);
    for (let e = 0; e < edgeCount; e += 1) {
      const a = edges[e * 2];
      const b = edges[e * 2 + 1];
      lineArr.set([pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], e * 6);
    }
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lineArr, 3));
    brain.add(new THREE.LineSegments(lineGeo, track(new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.2, blending: add, depthWrite: false }))));

    // pulses: bright points that run along the edges, hopping to a neighbouring edge at each end
    const adjacency = Array.from({ length: count }, () => []);
    for (let e = 0; e < edgeCount; e += 1) {
      adjacency[edges[e * 2]].push(e);
      adjacency[edges[e * 2 + 1]].push(e);
    }
    const pulseCount = lite ? 70 : 220;
    const pulses = Array.from({ length: pulseCount }, () => ({ edge: Math.floor(rand() * edgeCount), t: rand(), forward: rand() < 0.5, speed: 0.5 + rand() * 1.1 }));
    const pulseGeo = track(new THREE.BufferGeometry());
    const pulseArr = new Float32Array(pulseCount * 3);
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulseArr, 3));
    brain.add(new THREE.Points(pulseGeo, track(new THREE.PointsMaterial({ size: 0.06, map: dot, color: 0xe8fdff, transparent: true, blending: add, depthWrite: false }))));

    // a scan ring sweeping through the brain
    const scan = new THREE.LineLoop(track(circle(0.62, 96)), track(new THREE.LineBasicMaterial({ color: ICE, transparent: true, opacity: 0.5, blending: add, depthWrite: false })));
    brain.add(scan);

    // --- amber orbital rings
    const ringGroup = new THREE.Group(); // scaled with the satellites on narrow screens
    root.add(ringGroup);
    const rings = [
      { r: 2, tilt: [1.2, 0.1], speed: 0.25 },
      { r: 2.45, tilt: [0.5, 0.6], speed: -0.18 },
      { r: 2.9, tilt: [-0.35, -0.4], speed: 0.12 },
    ].map(({ r, tilt, speed }) => {
      const line = new THREE.LineLoop(track(circle(r)), track(new THREE.LineDashedMaterial({ color: AMBER, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.75, blending: add, depthWrite: false })));
      line.computeLineDistances();
      line.rotation.set(tilt[0], 0, tilt[1]);
      ringGroup.add(line);
      return { line, speed };
    });
    // ground rings under the brain
    for (const r of [1.7, 2.6]) {
      const base = new THREE.LineLoop(track(circle(r)), track(new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.25, blending: add, depthWrite: false })));
      base.position.y = -1.7;
      root.add(base);
    }

    // --- satellites: one per project
    const orbit = new THREE.Group();
    orbit.rotation.x = 0.28;
    root.add(orbit);
    let satellites = [];
    const shapes = new Map(); // kind -> shared EdgesGeometry
    const shapeEdges = (kind) => {
      if (!shapes.has(kind)) {
        const base = shapeGeometry(kind);
        shapes.set(kind, new THREE.EdgesGeometry(base, 1));
        base.dispose();
      }
      return shapes.get(kind);
    };
    const glowMat = (color, size, opacity) => new THREE.PointsMaterial({ size, map: dot, color, transparent: true, opacity, blending: add, depthWrite: false });
    const lineMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: add, depthWrite: false });
    const clearSatellites = () => {
      for (const s of satellites) {
        orbit.remove(s.group, s.link, s.packet);
        for (const part of s.own) {
          part.geometry?.dispose();
          part.material.dispose();
        }
        s.label.remove();
      }
      satellites = [];
    };
    const setProjects = (list) => {
      clearSatellites();
      const shown = list.slice(0, MAX_SATELLITES);
      shown.forEach((p, i) => {
        const color = p.status === 'terminado' ? CYAN : AMBER;
        const group = new THREE.Group();
        const body = new THREE.LineSegments(shapeEdges(SHAPES[hashOf(p.id) % SHAPES.length]), lineMat(color, 0.9));
        body.scale.setScalar(0.22);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color, transparent: true, opacity: 0.55, blending: add, depthWrite: false }));
        glow.scale.setScalar(0.7);
        const beam = new THREE.LineLoop(circle(0.3, 48), lineMat(ICE, 0.85));
        group.add(body, glow, beam);
        const link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat(color, 0.28));
        const packetGeo = new THREE.BufferGeometry();
        packetGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
        const packet = new THREE.Points(packetGeo, glowMat(ICE, 0.09, 1));
        orbit.add(group, link, packet);

        const label = document.createElement('button');
        label.type = 'button';
        label.className = `c3d-tag ${p.status === 'terminado' ? 'c3d-tag--done' : 'c3d-tag--wip'}`;
        label.textContent = p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name;
        label.addEventListener('click', () => latest.current.onSelect?.(p.id));
        host.appendChild(label);
        // the edges geometry is shared, so it is not in `own`
        satellites.push({ id: p.id, group, body, beam, link, packet, label, own: [{ material: body.material }, { material: glow.material }, beam, link, packet], radius: 3.4 + (i % 3) * 0.4, angle: (i / shown.length) * Math.PI * 2, speed: 0.07 + (i % 3) * 0.018, lift: ((i % 4) - 1.5) * 0.18, phase: i * 1.7 });
      });
    };
    setProjects(latest.current.projects);
    apiRef.current = { setProjects };

    // --- size, pointer, loop
    let width = 1;
    let height = 1;
    const fit = () => {
      width = host.clientWidth || 1;
      height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // on narrow screens the rings and satellites draw in, so everything stays inside the frame
      const compact = THREE.MathUtils.clamp(camera.aspect / 1.2, 0.6, 1);
      orbit.scale.setScalar(compact);
      ringGroup.scale.setScalar(compact);
      const half = Math.tan((camera.fov * Math.PI) / 360);
      camera.position.set(0, 0.45, Math.max(8.6, (4.2 * compact) / (half * camera.aspect)));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();

    let tiltX = 0;
    let tiltY = 0;
    let wantX = 0;
    let wantY = 0;
    const onPointer = (e) => {
      const box = host.getBoundingClientRect();
      wantY = ((e.clientX - box.left) / box.width - 0.5) * 0.5;
      wantX = ((e.clientY - box.top) / box.height - 0.5) * 0.22;
    };
    host.addEventListener('pointermove', onPointer);

    const world = new THREE.Vector3();
    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      if (!still) brain.rotation.y += dt * 0.14;
      tiltX += (wantX - tiltX) * 0.05;
      tiltY += (wantY - tiltY) * 0.05;
      root.rotation.set(tiltX, tiltY, 0);
      scan.position.y = Math.sin(time * 0.9) * 0.5;
      scan.material.opacity = 0.25 + 0.3 * (1 - Math.abs(Math.sin(time * 0.9)));
      for (const r of rings) if (!still) r.line.rotation.y += dt * r.speed;

      for (const p of pulses) {
        p.t += dt * p.speed;
        if (p.t >= 1) {
          const end = p.forward ? edges[p.edge * 2 + 1] : edges[p.edge * 2];
          const next = adjacency[end][Math.floor(Math.random() * adjacency[end].length)] ?? p.edge;
          p.forward = edges[next * 2] === end;
          p.edge = next;
          p.t = 0;
        }
      }
      for (let i = 0; i < pulses.length; i += 1) {
        const p = pulses[i];
        const a = edges[p.edge * 2] * 3;
        const b = edges[p.edge * 2 + 1] * 3;
        const k = p.forward ? p.t : 1 - p.t;
        pulseArr[i * 3] = pos[a] + (pos[b] - pos[a]) * k;
        pulseArr[i * 3 + 1] = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * k;
        pulseArr[i * 3 + 2] = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * k;
      }
      pulseGeo.attributes.position.needsUpdate = true;

      const active = latest.current.activeId;
      for (const s of satellites) {
        if (!still) s.angle += dt * s.speed;
        const x = Math.cos(s.angle) * s.radius;
        const z = Math.sin(s.angle) * s.radius;
        const y = s.lift + Math.sin(time * 0.8 + s.phase) * 0.08;
        s.group.position.set(x, y, z);
        s.body.rotation.y += dt * 0.6;
        s.body.rotation.x += dt * 0.3;
        // the scanning ring runs up and down the model
        s.beam.position.y = Math.sin(time * 1.6 + s.phase) * 0.24;
        s.beam.material.opacity = 0.45 + 0.4 * Math.abs(Math.cos(time * 1.6 + s.phase));
        const attr = s.link.geometry.attributes.position;
        attr.setXYZ(0, 0, 0, 0);
        attr.setXYZ(1, x, y, z);
        attr.needsUpdate = true;
        const k = (time * 0.45 + s.phase) % 1;
        s.packet.geometry.attributes.position.setXYZ(0, x * k, y * k, z * k);
        s.packet.geometry.attributes.position.needsUpdate = true;
        s.body.material.opacity = s.id === active ? 1 : 0.85;

        s.group.getWorldPosition(world);
        world.project(camera);
        const hidden = world.z > 1;
        s.label.style.opacity = hidden ? '0' : '1';
        s.label.style.pointerEvents = hidden ? 'none' : 'auto';
        s.label.style.transform = `translate(${((world.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-world.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, 22px)`;
      }
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      host.removeEventListener('pointermove', onPointer);
      apiRef.current = null;
      clearSatellites();
      for (const geometry of shapes.values()) geometry.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    apiRef.current?.setProjects(projects);
  }, [projects]);

  return <div className="c3d-core" ref={hostRef} />;
}
