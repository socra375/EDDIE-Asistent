import { useEffect, useState } from 'react';
import ParticleRing from './ParticleRing';
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

// Eddie's central control: a ring of flowing light particles around an empty
// dark disc, with the EDDIE name and a status chip under it. The whole circle
// is the push-to-talk button. `state` drives the animation: idle | listening |
// processing | speaking | disabled | error (see ParticleRing and Home.css).
//
// The disc in the middle (`eddie-orb__slot`) is kept clear on purpose: it is
// where the picture Eddie is asked for appears (see services/centerImage.js).
export default function EddieOrb({ state, label, onActivate, actionLabel, labelTitle, onLabelClick }) {
  const picture = useCenterImage();
  return (
    <div className="eddie-orb" data-state={state}>
      <button type="button" className="eddie-orb__hit" onClick={onActivate} aria-label={actionLabel}>
        <span className="eddie-orb__glow" aria-hidden="true" />
        <span className="eddie-orb__slot" aria-hidden="true">
          {picture && (
            <img
              key={picture.id}
              className="eddie-orb__image"
              src={mediaUrl(picture.id)}
              alt=""
              draggable="false"
              onError={() => setCenterImage(null)}
            />
          )}
        </span>
        <ParticleRing state={state} />
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
