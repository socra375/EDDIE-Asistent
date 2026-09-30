import './EddieLogo.css';

// Vector version of Eddie's logo (public/eddie-icon-512.png and
// public/eddie-logo.png). Both share the 512×512 mark coordinates, so the
// wordmark simply extends the mark's viewBox to the right. Colors come from
// the --logo-* tokens, which the light theme redefines.

const C = 256;

function polar(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arc(r, from, to) {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

// Four cyan quarter arcs with gaps at the cardinal points, where the short
// amber arcs sit.
const CYAN_ARCS = [0, 90, 180, 270].map((q) => arc(225, q + 15, q + 75)).join('');
const AMBER_ARCS = [0, 90, 180, 270].map((q) => arc(226, q - 8, q + 8)).join('');

// Tick ring: every 5°, longer every 30°.
const TICKS = Array.from({ length: 72 }, (_, i) => {
  const deg = i * 5;
  const inner = deg % 30 === 0 ? 169 : 176;
  const [x1, y1] = polar(inner, deg);
  const [x2, y2] = polar(184, deg);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
}).join('');

function MarkShapes() {
  return (
    <>
      <path className="eddie-logo__ring" d={CYAN_ARCS} strokeWidth="12" />
      <path className="eddie-logo__amber-stroke" d={AMBER_ARCS} strokeWidth="6" />
      <circle className="eddie-logo__dots" cx={C} cy={C} r="196" strokeWidth="2.5" strokeDasharray="1.5 6" />
      <path className="eddie-logo__ticks" d={TICKS} strokeWidth="2" />
      <path className="eddie-logo__letter" d="M183 185h145v29H214v83h114v29H183Z" />
      <rect className="eddie-logo__amber" x="214" y="242" width="96" height="28" />
      <rect className="eddie-logo__amber" x="322" y="242" width="14" height="28" opacity="0.8" />
    </>
  );
}

// Letter shapes of the wordmark, traced from the 1200×512 PNG.
const D_SHAPE = (x) =>
  `M${x} 188h45a48 67.5 0 0 1 0 135h-45Zm25 27v81h20a23 40.5 0 0 0 0-81Z`;
const E_SHAPE = (x) => `M${x} 188h81v27h-56v27h42v27h-42v27h56v27h-81Z`;

export function EddieMark({ size = 32, className = '', title }) {
  return (
    <svg
      className={`eddie-logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <MarkShapes />
    </svg>
  );
}

export function EddieWordmark({ height = 48, className = '', title = 'Eddie' }) {
  // Cropped to the artwork (x 20–1080, y 20–492) so it sits tight in a row.
  return (
    <svg
      className={`eddie-logo eddie-logo--wordmark ${className}`}
      height={height}
      width={(height * 1060) / 472}
      viewBox="20 20 1060 472"
      role="img"
      aria-label={title}
    >
      <MarkShapes />
      <path
        className="eddie-logo__letter"
        fillRule="evenodd"
        d={`${E_SHAPE(580)}${D_SHAPE(696)}${D_SHAPE(812)}M929 188h25v135h-25Z${E_SHAPE(976)}`}
      />
      <path
        className="eddie-logo__amber-stroke"
        d="M584 375H780L797 350L822 402L840 375H1062"
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
