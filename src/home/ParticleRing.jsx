import { useEffect, useRef } from 'react';
import { BAND_SET, blendParams, createParticles, paramsFor, particleAt, spineLine } from './particleRing.js';

const COUNT = 3400;
const LITE_COUNT = 1700;
// Fine threads of light along each ribbon (across: from one edge to the other).
const THREADS = [-0.8, 0, 0.8];
const FRAME_MS = 50; // ~20 fps: it is a flowing background, not a game
const LITE_FRAME_MS = 100;
const LEVELS = 5; // brightness steps: one fillStyle per step, not per particle
const TWO_PI = Math.PI * 2;

const isCalm = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isLite = () => document.documentElement.dataset.perf === 'lite';

// The colour a CSS custom property resolves to, as "r,g,b" (a throw-away element lets the browser do the work).
function resolveRgb(host, varName, fallback) {
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${varName})`;
  host.appendChild(probe);
  const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(getComputedStyle(probe).color || '');
  probe.remove();
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

// A flow of thousands of luminous points along undulating ribbons that wind around a circle, with the
// middle left empty (an image will be shown there some day). `state` changes the speed, the waviness,
// the brightness and the colour: it flows gently when idle, pulses while listening or speaking, races and
// turns amber while thinking, freezes grey when disabled and flashes red on an error.
export default function ParticleRing({ state }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const live = useRef({
    state,
    params: paramsFor(state),
    rgb: [63, 232, 255],
    particles: createParticles(COUNT),
    size: { w: 0, dpr: 1 },
    clock: 0,
    last: 0,
    visible: true,
    running: false,
    force: false, // a resize, a new state or a new colour must be drawn at once, not wait for the next tick
    request: () => {},
    refreshColor: () => {},
  });

  useEffect(() => {
    const s = live.current;
    s.state = state;
    s.refreshColor();
    s.force = true;
    s.request();
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext('2d');
    const s = live.current;
    const buckets = Array.from({ length: LEVELS }, () => new Float32Array(COUNT * 3)); // x, y, size per particle
    const counts = new Int32Array(LEVELS);

    // The ring's colour follows the state through the same custom properties the rest of the orb uses.
    s.refreshColor = () => {
      const host = wrap.closest('.eddie-orb') || wrap;
      const tint = paramsFor(s.state).tint;
      s.rgb = resolveRgb(host, tint === 'soft' ? '--ring-soft' : '--ring', s.rgb);
    };

    function resize() {
      const w = wrap.clientWidth;
      if (!w) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      s.size = { w, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * dpr);
      s.force = true; // setting the size cleared the canvas
      s.request();
    }

    function draw() {
      const { w, dpr } = s.size;
      if (!w) return;
      const half = w / 2;
      const target = paramsFor(s.state);
      s.params = blendParams(s.params, target);
      const params = s.params;
      const n = isLite() ? LITE_COUNT : COUNT;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, w);
      counts.fill(0);
      const flash = s.state === 'error' ? 0.65 + 0.35 * Math.abs(Math.sin(s.clock * 9)) : 1;
      for (let i = 0; i < n; i += 1) {
        const p = s.particles[i];
        const q = particleAt(p, s.clock, params);
        const a = q.alpha * flash;
        if (a < 0.05) continue;
        const level = Math.min(LEVELS - 1, Math.floor(a * LEVELS));
        const b = buckets[level];
        const at = counts[level] * 3;
        b[at] = half + q.x * half;
        b[at + 1] = half + q.y * half;
        b[at + 2] = p.size * (w > 420 ? 1.15 : 1);
        counts[level] += 1;
      }
      const [r, g, bl] = s.rgb;
      // Overlapping points add up, so the ribbons glow where they bunch.
      ctx.globalCompositeOperation = 'lighter';
      // The threads: one thin line along each ribbon (fewer in Modo ligero).
      ctx.lineWidth = w > 420 ? 1 : 0.8;
      const threadSteps = isLite() ? 40 : 72;
      for (let b = 0; b < BAND_SET.length; b += 1) {
        for (const across of isLite() ? [0] : THREADS) {
          const line = spineLine(b, across, s.clock, params, threadSteps);
          ctx.strokeStyle = `rgba(${r},${g},${bl},${(across === 0 ? 0.34 : 0.17) * params.glow * flash})`;
          ctx.beginPath();
          line.forEach((q, i) => (i ? ctx.lineTo(half + q.x * half, half + q.y * half) : ctx.moveTo(half + q.x * half, half + q.y * half)));
          ctx.stroke();
        }
      }
      for (let level = 0; level < LEVELS; level += 1) {
        const alpha = ((level + 0.7) / LEVELS) * 0.8;
        // The brightest steps lean toward white, so the spine of each ribbon glows.
        const mix = level >= LEVELS - 2 ? (level - (LEVELS - 3)) * 0.22 : 0;
        ctx.fillStyle = `rgba(${Math.round(r + (255 - r) * mix)},${Math.round(g + (255 - g) * mix)},${Math.round(bl + (255 - bl) * mix)},${Math.min(1, alpha)})`;
        const b = buckets[level];
        for (let k = 0, m = counts[level] * 3; k < m; k += 3) ctx.fillRect(b[k] - b[k + 2] / 2, b[k + 1] - b[k + 2] / 2, b[k + 2], b[k + 2]);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame(now) {
      s.running = false;
      const calm = isCalm();
      const animating = !calm && s.visible && !document.hidden;
      const target = paramsFor(s.state);
      const settling = Math.abs(s.params.speed - target.speed) > 0.01 || Math.abs(s.params.amp - target.amp) > 0.005 || Math.abs(s.params.glow - target.glow) > 0.005;
      const flowing = animating && target.speed > 0;
      if (now - s.last >= (isLite() ? LITE_FRAME_MS : FRAME_MS) || !animating || s.force) {
        s.force = false;
        const dt = Math.min((now - (s.last || now)) / 1000, 0.2);
        if (flowing) s.clock += dt;
        else if (animating && settling) s.clock += dt * s.params.speed;
        s.last = now;
        draw();
      }
      if ((flowing || (animating && settling) || s.state === 'error') && animating) request();
    }

    function request() {
      if (s.running) return;
      s.running = true;
      requestAnimationFrame(frame);
    }
    s.request = request;

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const seen = new IntersectionObserver(([entry]) => {
      s.visible = entry.isIntersecting;
      if (s.visible) {
        s.force = true;
        request();
      }
    });
    seen.observe(wrap);
    // A new theme, core colour or Modo ligero shows at once.
    const mode = new MutationObserver(() => {
      s.refreshColor();
      s.force = true;
      request();
    });
    mode.observe(document.documentElement, { attributes: true, attributeFilter: ['data-core', 'data-theme', 'data-perf'] });
    const onVisibility = () => !document.hidden && request();
    document.addEventListener('visibilitychange', onVisibility);
    s.refreshColor();
    resize();
    request();

    return () => {
      observer.disconnect();
      seen.disconnect();
      mode.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      s.request = () => {};
      s.running = true; // a frame already queued does nothing more
    };
  }, []);

  return (
    <span className="eddie-orb__ring" ref={wrapRef} aria-hidden="true" data-bands={BAND_SET.length}>
      <canvas ref={canvasRef} className="eddie-orb__canvas" />
    </span>
  );
}
