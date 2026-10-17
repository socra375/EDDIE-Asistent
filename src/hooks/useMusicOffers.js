import { useEffect, useRef } from 'react';
import { fetchOffer } from '../services/musicOffers';

const FIRST_CHECK_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;

// While Eddie is open and the user is doing something else, every few minutes asks the server whether there is a song
// worth offering at this hour (the server decides: cooldowns, daily limit, quiet hours). `busy()` says whether Eddie is
// in the middle of an answer or a video is already playing; then nothing is asked.
export function useMusicOffers({ enabled, busy, onOffer }) {
  const latest = useRef({ busy, onOffer });
  latest.current = { busy, onOffer };

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const check = async () => {
      if (cancelled || document.hidden || latest.current.busy()) return;
      const offer = await fetchOffer();
      if (!cancelled && offer && !latest.current.busy()) latest.current.onOffer(offer);
    };
    const first = window.setTimeout(check, FIRST_CHECK_MS);
    const every = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [enabled]);
}
