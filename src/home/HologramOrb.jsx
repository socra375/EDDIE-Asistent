import { useEffect, useRef } from 'react';

const TWO_PI = Math.PI * 2;

const isCalm = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isLite = () => document.documentElement.dataset.perf === 'lite';

// Fewer particles/ticks on weak devices (Modo ligero): same shape, less to draw.
function countsFor(lite) {
  return lite ? { particles: 900, ticks: 24 } : { particles: 3000, ticks: 48 };
}

// The colour a CSS custom property resolves to, as [r,g,b] (a throw-away element lets the browser do the work).
function resolveRgb(host, varName, fallback) {
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${varName})`;
  host.appendChild(probe);
  const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(getComputedStyle(probe).color || '');
  probe.remove();
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

const THINKING_COLOR = [157, 0, 255]; // violet: "working something out" — processing, or loading a core image

// Jarvis-style mood palette: the user's own colour (the core-colour picker in
// Configuración → Interfaz HUD) at rest, violet while it works something out, red-orange
// on a warning or error.
function paletteFor(state, user) {
  if (state === 'processing') return THINKING_COLOR;
  if (state === 'error') return [255, 51, 0];
  return user;
}

// How fast it spins and how tightly the swarm pulls toward the core, per state: calm at
// rest, a fast inward collapse while it thinks, a held, pulsing contraction on a warning.
function motionFor(state) {
  switch (state) {
    case 'processing':
      return { spin: 3.2, radius: 0.55 };
    case 'listening':
    case 'speaking':
      return { spin: 1.5, radius: 0.92 };
    case 'disabled':
      return { spin: 0.3, radius: 1 };
    default:
      return { spin: 1, radius: 1 };
  }
}

const SHOCK_SLOTS = 4; // a small fixed pool, reused — no allocating during the render loop
const SHOCK_LIFE = 0.9; // seconds
const WARNING_PERIOD = 0.9; // seconds between shockwaves while in a warning/error state

// A J.A.R.V.I.S.-style holographic orb drawn with Canvas 2D only (no WebGL/Three.js): a
// pulsing glassy core, a swarm of particles orbiting in a faked 3D space (rotated with Y
// then Z rotation matrices and projected with simple perspective), three concentric
// dashed data rings — one with compass-style radial ticks — and a soft mouse-parallax
// tilt. Colour and motion both react to `state`: the user's own core colour (and a calm
// pulse) at rest, violet with a fast inward collapse while "thinking", red-orange with
// recurring shockwaves on a warning or error. Everything the render loop touches each
// frame is allocated once, up front, to keep this at 60 fps. `window.actualizarImagenNucleo(url)`
// projects a web image into the core (preloaded off-screen, faded in over the glow, with
// an automatic fallback to the plain energy core on any load error).
export default function HologramOrb({ state }) {
  const wrapRef = useRef(null);
  const live = useRef({ state, refreshColor: () => {}, request: () => {}, triggerShock: () => {}, setCoreImage: () => {} });

  useEffect(() => {
    const prev = live.current.state;
    live.current.state = state;
    live.current.refreshColor();
    if (state !== prev && (state === 'listening' || state === 'processing') && prev !== 'listening' && prev !== 'processing') live.current.triggerShock();
    live.current.request();
  }, [state]);

  // `actualizarImagenNucleo(url)`: a public, global hook so a future web-image-search
  // result can be projected into the core (Stark-style), from anywhere — not just from
  // this component. Only one orb is ever mounted at a time, so a simple global is enough;
  // it is restored (not just deleted) on unmount in case something else ever defines it.
  useEffect(() => {
    const previous = window.actualizarImagenNucleo;
    window.actualizarImagenNucleo = (url) => live.current.setCoreImage(url);
    return () => {
      window.actualizarImagenNucleo = previous;
    };
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const s = live.current;
    const lite = isLite();
    const { particles: COUNT, ticks: TICKS } = countsFor(lite);

    const canvas = document.createElement('canvas');
    canvas.className = 'eddie-orb__canvas';
    wrap.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // ---- allocate once: the particle swarm (unit-sphere positions, biased toward the
    // shell so it reads as a hollow globe, not a solid ball) and the shockwave pool. ----
    const px = new Float32Array(COUNT);
    const py = new Float32Array(COUNT);
    const pz = new Float32Array(COUNT);
    const psize = new Float32Array(COUNT);
    const palpha = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * TWO_PI;
      const ring = Math.sqrt(1 - u * u);
      const r = 0.72 + Math.random() * 0.28;
      px[i] = ring * Math.cos(theta) * r;
      py[i] = ring * Math.sin(theta) * r;
      pz[i] = u * r;
      psize[i] = 0.7 + Math.random() * 1.3;
      palpha[i] = 0.35 + Math.random() * 0.5;
    }
    const shocks = Array.from({ length: SHOCK_SLOTS }, () => ({ t: SHOCK_LIFE }));
    let nextShock = 0;
    let warningClock = 0;

    const BLACK = '#050510'; // solid black (not the app's theme), for the floating effect
    const SPHERE_R = 150;
    const CAMERA_D = 340;
    const FOCAL = 260;

    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;

    function resize() {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight || cw;
      if (!cw || !ch) return;
      const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = cw;
      h = ch;
      cx = w / 2;
      cy = h / 2;
      draw();
    }

    let userRgb = [63, 232, 255];
    let colorNow = userRgb.slice();
    s.refreshColor = () => {
      const host = wrap.closest('.eddie-orb') || wrap;
      userRgb = resolveRgb(host, '--ring', userRgb);
    };
    s.refreshColor();
    colorNow = paletteFor(s.state, userRgb).slice();

    s.triggerShock = () => {
      shocks[nextShock].t = 0;
      nextShock = (nextShock + 1) % SHOCK_SLOTS;
    };

    // ---- the core image (actualizarImagenNucleo): precargada off-screen so the 60fps
    // loop never stalls, faded out (while pulsing violet, "thinking") during the load and
    // faded back in once it lands; any failure — a broken URL, a CORS-blocked host — just
    // restores the plain energy core, so the orb is never left blank or broken. ----
    let coreImage = null;
    let imageLoading = false;
    let imageAlpha = 0;
    let loadToken = 0;
    s.setCoreImage = (url) => {
      loadToken += 1;
      const myToken = loadToken;
      imageLoading = true;
      request();
      const img = new Image();
      // No crossOrigin: a typical web-search image result carries no CORS header, and
      // this orb only ever draws the image (no getImageData/toDataURL), so a "tainted"
      // canvas is harmless here — asking for crossOrigin would just make more images fail
      // to load at all.
      img.onload = () => {
        if (myToken !== loadToken) return; // superseded by a newer call
        coreImage = img;
        imageLoading = false;
        request();
      };
      img.onerror = () => {
        if (myToken !== loadToken) return;
        coreImage = null;
        imageLoading = false;
        request();
      };
      img.src = url;
    };

    // ---- mouse parallax: a soft eased tilt, not a drag — the circle is a button, not a
    // thing to spin by hand. ----
    let targetTiltY = 0;
    let targetTiltZ = 0;
    let tiltY = 0;
    let tiltZ = 0;
    function onMove(e) {
      const rect = wrap.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      targetTiltY = mx * 0.5;
      targetTiltZ = my * 0.35;
    }
    function onLeave() {
      targetTiltY = 0;
      targetTiltZ = 0;
    }
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);

    let running = false;
    let visible = true;
    let last = 0;
    let time = 0;
    let spinY = 0;
    let spinZ = 0;
    let radiusFactor = 1;
    // Scratch variables for the per-particle loop, declared once so the 60fps loop never
    // allocates: this is the whole point of preallocating the typed arrays above too.
    let x0, y0, z0, x1, y1, z1, x2, y2, z2, zc, scale, sx, sy, size, alpha;
    let cosY, sinY, cosZ, sinZ;

    function draw() {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = BLACK;
      ctx.fillRect(0, 0, w, h);

      const target = imageLoading ? THINKING_COLOR : paletteFor(s.state, userRgb);
      colorNow[0] += (target[0] - colorNow[0]) * 0.06;
      colorNow[1] += (target[1] - colorNow[1]) * 0.06;
      colorNow[2] += (target[2] - colorNow[2]) * 0.06;
      const [r, g, b] = colorNow;

      ctx.globalCompositeOperation = 'lighter';

      // The particle swarm: rotate each point with Y then Z rotation matrices, project
      // with basic perspective, draw as a tiny filled dot.
      cosY = Math.cos(spinY + tiltY);
      sinY = Math.sin(spinY + tiltY);
      cosZ = Math.cos(spinZ + tiltZ);
      sinZ = Math.sin(spinZ + tiltZ);
      const R = SPHERE_R * radiusFactor;
      for (let i = 0; i < COUNT; i += 1) {
        x0 = px[i];
        y0 = py[i];
        z0 = pz[i];
        x1 = x0 * cosY + z0 * sinY;
        z1 = -x0 * sinY + z0 * cosY;
        y1 = y0;
        x2 = x1 * cosZ - y1 * sinZ;
        y2 = x1 * sinZ + y1 * cosZ;
        z2 = z1;
        zc = z2 * R + CAMERA_D;
        scale = FOCAL / zc;
        sx = cx + x2 * R * scale;
        sy = cy + y2 * R * scale;
        size = psize[i] * scale * 1.4;
        if (size < 0.15) continue;
        alpha = palpha[i] * Math.min(1, scale * 1.3);
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, TWO_PI);
        ctx.fill();
      }

      // Three concentric dashed data rings, each at its own speed and direction; the
      // outermost also gets compass-style radial ticks.
      const ringBase = Math.min(w, h) * 0.46;
      const ringSpecs = [
        { radiusMul: 1, squash: 0.92, speed: 0.4, dash: [10, 8], width: 1.4 },
        { radiusMul: 0.8, squash: 0.8, speed: -0.65, dash: [3, 7], width: 1.1 },
        { radiusMul: 0.62, squash: 0.68, speed: 0.95, dash: [1, 5], width: 1 },
      ];
      ctx.lineWidth = 1;
      for (let i = 0; i < ringSpecs.length; i += 1) {
        const spec = ringSpecs[i];
        const radius = ringBase * spec.radiusMul;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, spec.squash);
        ctx.rotate(time * spec.speed);
        ctx.setLineDash(spec.dash);
        ctx.lineDashOffset = -time * 60 * Math.sign(spec.speed || 1);
        ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},0.55)`;
        ctx.lineWidth = spec.width;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, TWO_PI);
        ctx.stroke();
        if (i === 0) {
          ctx.setLineDash([]);
          for (let t = 0; t < TICKS; t += 1) {
            const a = (t / TICKS) * TWO_PI;
            const long = t % (TICKS / 8) === 0;
            const inner = radius - (long ? 10 : 5);
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
            ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // The core: a pulsing glassy glow, white at the centre fading into the mood
      // colour, with real canvas bloom (shadowBlur) since it is a single draw.
      const breathing = 1 + 0.12 * Math.sin(time * 1.6);
      const audioJitter = s.state === 'listening' || s.state === 'speaking' ? (Math.random() - 0.5) * 0.1 + Math.sin(time * 14) * 0.05 : 0;
      const flash = s.state === 'error' ? 0.7 + 0.3 * Math.abs(Math.sin(time * 9)) : 1;
      const coreR = Math.min(w, h) * 0.1 * (breathing + audioJitter) * flash;
      ctx.shadowBlur = 40;
      ctx.shadowColor = `rgba(${r | 0},${g | 0},${b | 0},0.9)`;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, `rgba(${r | 0},${g | 0},${b | 0},0.9)`);
      grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, TWO_PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      // A projected core image (actualizarImagenNucleo), cover-fit and clipped to the
      // core's own circle, cross-fading over the energy glow as imageAlpha eases in.
      if (coreImage && imageAlpha > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = imageAlpha;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, TWO_PI);
        ctx.clip();
        const iw = coreImage.naturalWidth || coreImage.width || 1;
        const ih = coreImage.naturalHeight || coreImage.height || 1;
        const side = coreR * 2;
        const coverScale = Math.max(side / iw, side / ih);
        const dw = iw * coverScale;
        const dh = ih * coverScale;
        ctx.drawImage(coreImage, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
      }

      // The activation/warning pulse: a ring expanding outward from the core, fading out.
      for (let i = 0; i < SHOCK_SLOTS; i += 1) {
        const sh = shocks[i];
        if (sh.t >= SHOCK_LIFE) continue;
        const t = sh.t / SHOCK_LIFE;
        const rad = coreR + t * ringBase * 1.1;
        ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${(1 - t) * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, TWO_PI);
        ctx.stroke();
      }
    }

    function frame(now) {
      running = false;
      const calm = isCalm();
      const animating = !calm && visible && !document.hidden;
      const imageTarget = !imageLoading && coreImage ? 1 : 0;
      if (animating) {
        const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
        last = now;
        time += dt;
        const motion = motionFor(imageLoading ? 'processing' : s.state);
        spinY += dt * 0.5 * motion.spin;
        spinZ += dt * 0.32 * motion.spin;
        tiltY += (targetTiltY - tiltY) * 0.08;
        tiltZ += (targetTiltZ - tiltZ) * 0.08;
        radiusFactor += (motion.radius - radiusFactor) * 0.05;
        imageAlpha += (imageTarget - imageAlpha) * 0.06;
        for (let i = 0; i < SHOCK_SLOTS; i += 1) if (shocks[i].t < SHOCK_LIFE) shocks[i].t += dt;
        if (s.state === 'error') {
          warningClock += dt;
          if (warningClock >= WARNING_PERIOD) {
            warningClock = 0;
            s.triggerShock();
          }
        } else warningClock = 0;
      } else {
        last = 0;
        imageAlpha = imageTarget; // reduced motion / hidden: snap, no fade to get stuck mid-way
      }
      draw();
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
      wrap.removeEventListener('mousemove', onMove);
      wrap.removeEventListener('mouseleave', onLeave);
      s.request = () => {};
      s.triggerShock = () => {};
      s.setCoreImage = () => {};
      running = true;
      canvas.remove();
    };
  }, []);

  return <span className="eddie-orb__ring" ref={wrapRef} aria-hidden="true" />;
}
