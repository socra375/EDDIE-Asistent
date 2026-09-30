// Decorative HUD overlays (hex grid, scanlines, vignette, corner frame).
// Fixed and click-through; hidden on the light theme via Layout.css.
export default function HudFx() {
  return (
    <div className="hud-fx" aria-hidden="true">
      <div className="hud-fx__hex" />
      <div className="hud-fx__scan" />
      <div className="hud-fx__vignette" />
      <div className="hud-fx__frame">
        <i />
      </div>
    </div>
  );
}
