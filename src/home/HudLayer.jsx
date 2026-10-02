import { useHud } from '../context/hudState';
import { useVision } from '../context/visionState';
import CameraPanel from './CameraPanel';
import { SystemPanel, TasksSummary, UptimePanel, WeatherPanel } from './InfoPanels';

// The info panels, only while they are asked for: all of them after
// "Activa sistema", one by one during "Dame los datos de hoy". The camera
// panel is there whenever the camera is on (or asking for permission).
export default function HudLayer({ onOpenTasks }) {
  const { visible, leaving } = useHud();
  const { phase } = useVision();
  const cameraOn = phase !== 'off';
  if (!visible.length && !cameraOn) return null;

  const panels = {
    weather: <WeatherPanel />,
    tasks: <TasksSummary onOpenTasks={onOpenTasks} />,
    system: <SystemPanel />,
    uptime: <UptimePanel />,
  };

  return (
    <aside className={`home__hud ${leaving ? 'home__hud--leaving' : ''}`} aria-label="Paneles de información">
      {cameraOn && (
        <div className="hud-slot" key="camera">
          <CameraPanel />
        </div>
      )}
      {visible.map((id) => (
        <div className="hud-slot" key={id}>
          {panels[id]}
        </div>
      ))}
    </aside>
  );
}
