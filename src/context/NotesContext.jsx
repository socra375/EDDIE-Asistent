import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from './SettingsContext';
import { useVoice } from './VoiceContext';
import { useChat } from './ChatContext';
import { dictationSupported, useDictation } from '../hooks/useDictation';
import { MAX_MINUTES, MAX_NOTE_CHARS, applyDictation, cleanMinutes, countWords, extractStop, formatMinutes } from '../services/dictation';
import { loadNotes, loadPrefs, newNote, saveNotes, savePrefs, trimNotes } from '../services/notes';
import { NOTES_EVENT, notesBridge } from '../services/notesBridge';
import { NotesContext } from './notesState';

const STT_LANG_MAP = { es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' };
// After "toma notas" Eddie says what he understood; the microphone opens when
// he is done (so it doesn't write his own voice), but never later than this.
const SPEECH_SETTLE_MS = 1300;
const SPEECH_MAX_WAIT_MS = 9000;
const SAVE_DEBOUNCE_MS = 400;

// Notas: sheets that Eddie writes while the user talks. Dictation keeps the
// microphone open (continuous recognition, see hooks/useDictation.js) for the
// time chosen — by the panel or by voice ("toma notas durante 10 minutos") —
// and turns what is heard into text on the sheet, with the punctuation said
// aloud. The wake word listener sleeps while it runs.
export function NotesProvider({ children }) {
  const { settings } = useSettings();
  const { speaking, listening, stop: stopVoice, speakWithSettings } = useVoice();
  const { addNote } = useChat();
  const lang = STT_LANG_MAP[settings.language] || 'es-ES';
  const autoRead = settings.voice.autoRead;

  const [notes, setNotes] = useState(loadNotes);
  const [activeId, setActiveId] = useState(() => loadNotes()[0]?.id || null);
  const [prefs, setPrefs] = useState(loadPrefs);
  // idle → waiting (Eddie is answering) → on (the microphone is open)
  const [phase, setPhase] = useState('idle');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [targetId, setTargetId] = useState(null); // the sheet being dictated

  const live = useRef({});
  useEffect(() => {
    live.current = { notes, activeId, prefs, phase, speaking, listening, autoRead, minutes: totalMinutes };
  });
  const run = useRef({ target: null, deadline: 0, minutes: 0, waitStarted: 0 });

  // ---- storage -----------------------------------------------------------
  useEffect(() => {
    const timer = window.setTimeout(() => saveNotes(notes), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [notes]);

  const createNote = useCallback(() => {
    const note = newNote();
    setNotes((prev) => trimNotes([note, ...prev]));
    setActiveId(note.id);
    return note;
  }, []);

  const updateNote = useCallback((id, patch) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, ...(patch.title !== undefined ? { title: String(patch.title).slice(0, 120) } : {}), ...(patch.body !== undefined ? { body: String(patch.body).slice(0, MAX_NOTE_CHARS) } : {}), updatedAt: Date.now() }
          : n,
      ),
    );
  }, []);

  const setMinutes = useCallback((minutes) => {
    setPrefs((prev) => {
      const next = { ...prev, minutes: cleanMinutes(minutes, prev.minutes) };
      savePrefs(next);
      return next;
    });
  }, []);

  const setPunctuation = useCallback((on) => {
    setPrefs((prev) => {
      const next = { ...prev, punctuation: Boolean(on) };
      savePrefs(next);
      return next;
    });
  }, []);

  // ---- dictation ---------------------------------------------------------
  const finishRef = useRef(null);
  const finish = useCallback(
    (reason) => {
      if (live.current.phase === 'idle') return null;
      const note = live.current.notes.find((n) => n.id === run.current.target);
      const words = countWords(note?.body);
      const minutes = run.current.minutes;
      run.current.target = null;
      run.current.deadline = 0;
      setTargetId(null);
      setPhase('idle');
      setSecondsLeft(0);
      if (reason === 'time') {
        const text = `Se acabó el tiempo de la nota (${formatMinutes(minutes)}). La hoja quedó con ${words} ${words === 1 ? 'palabra' : 'palabras'}.`;
        addNote(text);
        if (live.current.autoRead) speakWithSettings(text);
      } else if (reason === 'voice') {
        addNote(`Nota terminada: ${words} ${words === 1 ? 'palabra' : 'palabras'} en la hoja.`);
      }
      return { words };
    },
    [addNote, speakWithSettings],
  );
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const deleteNote = useCallback((id) => {
    if (run.current.target === id && live.current.phase !== 'idle') finishRef.current('manual');
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      return next;
    });
    setActiveId((current) => (current === id ? live.current.notes.find((n) => n.id !== id)?.id || null : current));
  }, []);

  // → { minutes, clamped, unsupported }
  const startDictation = useCallback(
    ({ minutes = null, fresh = false, show = false } = {}) => {
      const asked = minutes === null || minutes === undefined ? live.current.prefs.minutes : Math.round(Number(minutes));
      const chosen = cleanMinutes(asked);
      const clamped = chosen !== asked;
      if (!dictationSupported) return { minutes: chosen, clamped, unsupported: true };

      if (live.current.listening) stopVoice({ silent: true });
      let target = run.current.target;
      if (live.current.phase === 'idle' || !target) {
        const current = live.current.notes.find((n) => n.id === live.current.activeId);
        // A blank active sheet is reused instead of piling up empty ones.
        if (!fresh && current) target = current.id;
        else if (fresh && current && !current.body.trim() && !current.title.trim()) target = current.id;
        else target = createNote().id;
        setActiveId(target);
      }
      run.current.target = target;
      setTargetId(target);
      run.current.minutes = chosen;
      run.current.waitStarted = Date.now();
      run.current.deadline = 0;
      setTotalMinutes(chosen);
      setSecondsLeft(chosen * 60);
      setPhase((p) => (p === 'on' ? 'on' : 'waiting'));
      if (live.current.phase === 'on') run.current.deadline = Date.now() + chosen * 60_000;
      if (show) window.dispatchEvent(new CustomEvent(NOTES_EVENT, { detail: { action: 'show' } }));
      return { minutes: chosen, clamped, unsupported: false };
    },
    [createNote, stopVoice],
  );

  const stopDictation = useCallback((reason = 'manual') => finish(reason), [finish]);

  // Adds time to the running dictation.
  const extend = useCallback((minutes) => {
    if (live.current.phase !== 'on') return;
    const more = cleanMinutes(minutes, 5);
    const left = Math.max(0, run.current.deadline - Date.now()) + more * 60_000;
    const capped = Math.min(left, MAX_MINUTES * 60_000);
    run.current.deadline = Date.now() + capped;
    run.current.minutes = Math.max(run.current.minutes, Math.ceil(capped / 60_000));
    setTotalMinutes(run.current.minutes);
    setSecondsLeft(Math.ceil(capped / 1000));
  }, []);

  // "waiting": Eddie is still talking → open the microphone when he is done.
  useEffect(() => {
    if (phase !== 'waiting') return undefined;
    const delay = live.current.autoRead ? SPEECH_SETTLE_MS : 150;
    const poll = window.setInterval(() => {
      const waited = Date.now() - run.current.waitStarted;
      if (waited < delay) return;
      if (live.current.speaking && waited < SPEECH_MAX_WAIT_MS) return;
      window.clearInterval(poll);
      run.current.deadline = Date.now() + run.current.minutes * 60_000;
      setPhase('on');
    }, 150);
    return () => window.clearInterval(poll);
  }, [phase]);

  // "on": the countdown. Wall-clock based, so a busy page doesn't stretch it.
  useEffect(() => {
    if (phase !== 'on') return undefined;
    const tick = () => {
      const left = Math.ceil((run.current.deadline - Date.now()) / 1000);
      if (left <= 0) {
        finishRef.current('time');
        return;
      }
      setSecondsLeft(left);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Tapping the orb (the voice conversation) takes the microphone from the dictation.
  const wasListening = useRef(false);
  useEffect(() => {
    if (listening && !wasListening.current && live.current.phase !== 'idle') finishRef.current('mic');
    wasListening.current = listening;
  }, [listening]);

  const onHeard = useCallback(
    (text) => {
      const { stop, text: heard } = extractStop(text);
      const target = run.current.target;
      if (heard.trim() && target) {
        const punctuation = live.current.prefs.punctuation;
        setNotes((prev) => prev.map((n) => (n.id === target ? { ...n, body: applyDictation(n.body, heard, { punctuation }).slice(0, MAX_NOTE_CHARS), updatedAt: Date.now() } : n)));
      }
      if (stop) finishRef.current('voice');
    },
    [],
  );

  const dictation = useDictation({ active: phase === 'on', lang, paused: speaking, onFinal: onHeard });

  // The chat reaches Notas through the bridge.
  useEffect(() => {
    Object.assign(notesBridge, {
      isSupported: () => dictationSupported,
      isDictating: () => live.current.phase !== 'idle',
      defaultMinutes: () => live.current.prefs.minutes,
      start: ({ minutes } = {}) => startDictation({ minutes, fresh: true, show: true }),
      stop: () => finishRef.current('voice'),
      show: () => window.dispatchEvent(new CustomEvent(NOTES_EVENT, { detail: { action: 'show' } })),
    });
    return () =>
      Object.assign(notesBridge, {
        isSupported: () => true,
        isDictating: () => false,
        defaultMinutes: () => 10,
        start: ({ minutes } = {}) => ({ minutes: minutes ?? 10, clamped: false }),
        stop: () => null,
        show: () => {},
      });
  }, [startDictation]);

  // Lets the page go quietly: nothing keeps the microphone open after closing.
  useEffect(() => () => finishRef.current('manual'), []);

  const active = notes.find((n) => n.id === activeId) || null;
  const value = useMemo(
    () => ({
      notes,
      active,
      activeId,
      setActive: setActiveId,
      createNote,
      updateNote,
      deleteNote,
      prefs,
      setMinutes,
      setPunctuation,
      phase,
      dictating: phase !== 'idle',
      dictatingId: phase !== 'idle' ? targetId : null,
      status: phase === 'idle' ? 'off' : phase === 'waiting' ? 'starting' : dictation.status,
      reason: dictation.reason,
      interim: dictation.interim,
      secondsLeft,
      totalMinutes,
      supported: dictationSupported,
      startDictation,
      stopDictation,
      extend,
    }),
    [notes, active, activeId, targetId, createNote, updateNote, deleteNote, prefs, setMinutes, setPunctuation, phase, dictation.status, dictation.reason, dictation.interim, secondsLeft, totalMinutes, startDictation, stopDictation, extend],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}
