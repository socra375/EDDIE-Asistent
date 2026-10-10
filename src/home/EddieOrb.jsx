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

// Eddie's central control: a holographic sphere (Three.js) inside an empty dark
// disc, with the EDDIE name and a status chip under it. The whole circle is the
// push-to-talk button. `state` drives the animation: idle | listening | processing
// | speaking | disabled | error (see HologramOrb and Home.css).
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

      <h2 className="eddie-orb__name">E.D.D.I.E.</h2>
      {picture && (
        <button type="button" className="eddie-orb__clear" onClick={() => setCenterImage(null)} title={picture.prompt || 'Imagen del centro'}>
          Quitar la imagen del centro
        </button>
      )}
      {onLabelClick ? (
        <button type="button" className="eddie-orb__status eddie-orb__status--action" onClick={onLabelClick} title={labelTitle}>
          <span className="eddie-orb__dot" aria-hidden="true" />
          {label}
        </button>
      ) : (
        <p className="eddie-orb__status" role="status" title={labelTitle}>
          <span className="eddie-orb__dot" aria-hidden="true" />
          {label}
        </p>
      )}
    </div>
  );
}
