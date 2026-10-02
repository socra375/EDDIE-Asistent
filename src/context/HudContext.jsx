import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUD_EVENT, HUD_PANELS } from '../services/hudBridge';
import { HudContext } from './hudState';

const LEAVE_MS = 350;

// The panels are not part of the home screen any more: they show on request.
//   pinned  — "Activa sistema": all of them, until "Desactiva sistema".
//   shown   — "Dame los datos de hoy": each one appears as Eddie talks about
//             it and all go away when he stops (see useHudDirector).
//   pendingToday — a briefing asked for before the home screen was on screen.
export function HudProvider({ children }) {
  const [pinned, setPinned] = useState(false);
  const [shown, setShown] = useState([]);
  const [leaving, setLeaving] = useState(false);
  const [pendingToday, setPendingToday] = useState(false);
  const timer = useRef(null);

  const cancelLeave = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = null;
    setLeaving(false);
  }, []);

  const pin = useCallback(() => {
    cancelLeave();
    setPinned(true);
  }, [cancelLeave]);

  const reveal = useCallback(
    (id) => {
      if (!HUD_PANELS.includes(id)) return;
      cancelLeave();
      setShown((prev) => (prev.includes(id) ? prev : [...prev, id]));
    },
    [cancelLeave],
  );

  // Fades everything out, then forgets it.
  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPinned(false);
      setShown([]);
      setLeaving(false);
    }, LEAVE_MS);
  }, []);

  // Only the briefing's panels go; if the system is pinned they stay.
  const dismissBriefing = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = null;
    setShown([]);
  }, []);

  const consumeToday = useCallback(() => setPendingToday(false), []);

  useEffect(() => {
    const onHud = (e) => {
      const action = e.detail?.action;
      if (action === 'show') pin();
      else if (action === 'hide') dismiss();
      else if (action === 'today') setPendingToday(true);
    };
    window.addEventListener(HUD_EVENT, onHud);
    return () => {
      window.removeEventListener(HUD_EVENT, onHud);
      window.clearTimeout(timer.current);
    };
  }, [pin, dismiss]);

  const value = useMemo(
    () => ({ pinned, shown, leaving, pendingToday, visible: pinned ? HUD_PANELS : HUD_PANELS.filter((id) => shown.includes(id)), reveal, dismissBriefing, consumeToday }),
    [pinned, shown, leaving, pendingToday, reveal, dismissBriefing, consumeToday],
  );
  return <HudContext.Provider value={value}>{children}</HudContext.Provider>;
}
