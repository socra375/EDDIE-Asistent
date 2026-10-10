import { useEffect, useState } from 'react';
import HologramOrb from './HologramOrb';
import { CENTER_IMAGE_EVENT, getCenterImage, setCenterImage } from '../services/centerImage';
import { mediaUrl } from '../services/media';

// The picture Eddie last made (or the one picked in the Galería), kept by id.
function useCenterImage() {
  const [image, setImage] = useState(getCenterImage);
  useEffect(() => {
    const sync = () => setImage(getCenterImage());
    window.addEventListener(CENTER_IMAGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CENTER_IMAGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return image;
}

// Eddie's central control: just the holographic sphere (Three.js), full size,
// with nothing drawn over it — no name, no status chip, no hint: the whole
// circle is the push-to-talk button, and its look and `state`-driven effects
// (idle | listening | processing | speaking | disabled | error) are all there
// is (see HologramOrb and Home.css). The one exception is the status chip,
// which still appears, clickable, when the wake word needs the user to retry
// (`onLabelClick` is set) — otherwise there is nothing to click or read.
//
// The picture Eddie is asked for (see services/centerImage.js) floats over the
// sphere when there is one, in the same `eddie-orb__slot` disc as before.
export default function EddieOrb({ state, label, onActivate, actionLabel, labelTitle, onLabelClick }) {
  const picture = useCenterImage();
  return (
    <div className="eddie-orb" data-state={state}>
      <button type="button" className="eddie-orb__hit" onClick={onActivate} aria-label={actionLabel}>
        <HologramOrb state={state} />
        <span className="eddie-orb__glow" aria-hidden="true" />
        {picture && (
          <span className="eddie-orb__slot" aria-hidden="true">
            <img
              key={picture.id}
              className="eddie-orb__image"
              src={mediaUrl(picture.id)}
              alt=""
              draggable="false"
              onError={() => setCenterImage(null)}
            />
          </span>
        )}
      </button>

      {picture && (
        <button type="button" className="eddie-orb__clear" onClick={() => setCenterImage(null)} title={picture.prompt || 'Imagen del centro'}>
          Quitar la imagen del centro
        </button>
      )}
      {onLabelClick && (
        <button type="button" className="eddie-orb__status eddie-orb__status--action" onClick={onLabelClick} title={labelTitle}>
          <span className="eddie-orb__dot" aria-hidden="true" />
          {label}
        </button>
      )}
    </div>
  );
}
