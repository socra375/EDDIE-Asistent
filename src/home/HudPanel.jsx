export function HudPanel({ title, aside, children, className = '' }) {
  return (
    <section className={`glass-panel hud-panel ${className}`}>
      <h2 className="hud-panel__title">{title}</h2>
      {aside && <span className="hud-panel__aside">{aside}</span>}
      {children}
    </section>
  );
}

export function HudRow({ label, value, tone }) {
  return (
    <div className="hud-row">
      <span>{label}</span>
      <b className={tone ? `tone-${tone}` : undefined}>{value}</b>
    </div>
  );
}
