import { useEffect, useRef } from 'react';
import { useChat } from '../context/ChatContext';
import { useHud } from '../context/hudState';
import { useLocation } from '../context/LocationContext';
import { useSettings } from '../context/SettingsContext';
import { useVoice } from '../context/VoiceContext';
import { buildBriefing } from '../services/briefing';
import { getTasks } from '../utils/storage';
import { usePlaceAndWeather } from './usePlaceAndWeather';

const SILENT_STEP_MS = 3500; // per piece when Eddie's voice is off
const AFTER_MS = 1200; // panels stay a moment after the last word
const FAILSAFE_MS = 120_000;
const startedAt = Date.now();

async function readBattery() {
  try {
    const battery = await Promise.race([navigator.getBattery?.(), new Promise((resolve) => setTimeout(resolve, 600))]);
    return battery ? { level: Math.round(battery.level * 100), charging: battery.charging } : null;
  } catch {
    return null;
  }
}

// "Dame los datos de hoy": reads the day out piece by piece — date and time,
// weather, tasks, the computer, the session — and each panel appears as Eddie
// gets to it. When he stops talking (or is stopped) the panels go away. With
// his voice off they still appear, a few seconds apiece.
// Lives on the home screen, which is where the weather and the panels are.
export function useHudDirector() {
  const hud = useHud();
  const { location } = useLocation();
  const { place, weather } = usePlaceAndWeather(location);
  const { speakPiecesWithSettings, speaking, ttsSupported } = useVoice();
  const { settings } = useSettings();
  const { addNote, messages } = useChat();
  const run = useRef(null); // { heard: boolean, timers: [] } while a briefing is on
  const latest = useRef({});
  useEffect(() => {
    latest.current = { place, weather, messages, settings, ttsSupported, speakPiecesWithSettings, hud, addNote };
  });

  function finish() {
    const current = run.current;
    if (!current) return;
    current.timers.forEach(window.clearTimeout);
    run.current = null;
    window.setTimeout(() => latest.current.hud.dismissBriefing(), AFTER_MS);
  }

  // Eddie stopped talking (or was stopped): the briefing is over.
  const wasSpeaking = useRef(false);
  useEffect(() => {
    // `heard`: the first piece has started, so what is playing is the briefing
    // and not an earlier answer still finishing.
    if (!speaking && wasSpeaking.current && run.current?.voice && run.current.heard) finish();
    wasSpeaking.current = speaking;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking]);

  useEffect(() => {
    if (!hud.pendingToday) return;
    hud.consumeToday();
    (async () => {
      const l = latest.current;
      const battery = await readBattery();
      const pieces = buildBriefing({
        place: l.place,
        weather: l.weather,
        tasks: getTasks(),
        system: { battery, online: navigator.onLine, cores: navigator.hardwareConcurrency },
        session: { seconds: Math.floor((Date.now() - startedAt) / 1000), commands: l.messages.filter((m) => m.role === 'user' && !m.local).length },
      });
      l.addNote(pieces.map((p) => p.text).join(' '));
      if (run.current) finish();
      const voice = Boolean(l.settings.voice.autoRead && l.ttsSupported);
      const current = { voice, heard: false, timers: [] };
      run.current = current;
      current.timers.push(window.setTimeout(finish, FAILSAFE_MS));
      const show = (i) => {
        current.heard = true;
        if (pieces[i]?.panel) l.hud.reveal(pieces[i].panel);
      };
      if (voice) {
        l.speakPiecesWithSettings(pieces.map((p) => p.text), show);
      } else {
        pieces.forEach((_, i) => current.timers.push(window.setTimeout(() => show(i), i * SILENT_STEP_MS)));
        current.timers.push(window.setTimeout(finish, pieces.length * SILENT_STEP_MS));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud.pendingToday]);
}
