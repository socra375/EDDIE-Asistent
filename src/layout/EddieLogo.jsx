import './EddieLogo.css';

// Eddie's brand mark: a glowing "E" inside two orbiting ring arcs. Pure SVG
// (no image asset to ship/maintain) so it stays crisp at any size and can
// be animated with plain CSS, matching the app's futuristic-HUD look.
export default function EddieLogo({ size = 34 }) {
  return (
    <svg
      className="eddie-logo"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Eddie"
    >
      <defs>
        <linearGradient id="eddieLogoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <circle
        className="eddie-logo__ring eddie-logo__ring--outer"
        cx="50"
        cy="50"
        r="43"
        fill="none"
        stroke="url(#eddieLogoGradient)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="130 100"
      />
      <circle
        className="eddie-logo__ring eddie-logo__ring--inner"
        cx="50"
        cy="50"
        r="34"
        fill="none"
        stroke="url(#eddieLogoGradient)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="80 90"
      />
      <path
        className="eddie-logo__glyph"
        d="M38 30 H64 M38 30 V70 M38 50 H58 M38 70 H64"
        fill="none"
        stroke="url(#eddieLogoGradient)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
