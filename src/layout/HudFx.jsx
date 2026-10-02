// Decorative HUD overlay (hex grid, scanlines, vignette and the corner
// frame), drawn as a single fixed, click-through layer (see Layout.css).
// Hidden on the light theme and in "Modo ligero".
export default function HudFx() {
  return (
    <div className="hud-fx" aria-hidden="true">
      <div className="hud-fx__frame">
        <i />
      </div>
    </div>
  );
}
