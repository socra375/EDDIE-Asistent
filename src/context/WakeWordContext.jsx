import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from './SettingsContext';
import { useVoice } from './VoiceContext';
import { useChat } from './ChatContext';
import { useWakeWordListener, wakeWordSupported } from '../hooks/useWakeWordListener';
import { DEFAULT_WAKE_WORD, DEFAULT_FOLLOW_UP_SECONDS, cleanFollowUpSeconds } from '../services/wakeWord';
import { WakeWordContext } from './wakeWordState';

const STT_LANG_MAP = { es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' };
// The aborted wake recognizer needs a moment to let go of the microphone.
const HANDOFF_MS = 250;
// With the browser's recognizer a listen doesn't end by itself when the user
// stops talking, so after speech this much quiet ends it.
const END_OF_SPEECH_MS = 1600;
// Safety net: the voice counts as "speaking" from the moment it is asked for,
// so normally the window just waits for it. If the answer arrived and the
// voice never showed up for this long, assume it is not going to speak.
const SPEECH_GRACE_MS = 10000;
// Let the end of Eddie's voice (and its echo) die away before listening.
const ECHO_TAIL_MS = 500;
const POLL_MS = 300;

// Says "Eddie" -> Eddie wakes up, from any module. If a command follows in the
// same breath ("Eddie, ¿qué tengo hoy?") it is sent as it is; if only the word
// was said, the microphone opens for the command and what is heard is sent when
// the listen ends.
//
// A conversation started this way stays open: once Eddie has answered (and
// finished speaking) the microphone opens for `followUpSeconds` (the "tiempo
// de espera") so the user can answer without saying the word again. If they
// start talking it is sent and the window opens again after the next answer; if
// they say nothing the window closes and Eddie goes back to waiting for the
// word. The wake listener is paused while Eddie listens, works or speaks.
export function WakeWordProvider({ children }) {
  const { settings, updateVoiceSettings } = useSettings();
  const { listening, transcribing, transcript, interimTranscript, speechDetected, sttEngine, start, stop, reset, speaking, sttSupported, ttsSupported } =
    useVoice();
  const { status, sendMessage, lastReply } = useChat();

  const enabled = Boolean(settings.wake?.enabled);
  const word = settings.wake?.word || DEFAULT_WAKE_WORD;
  const followUp = cleanFollowUpSeconds(settings.wake?.followUpSeconds, DEFAULT_FOLLOW_UP_SECONDS);
  const lang = STT_LANG_MAP[settings.language] || 'es-ES';
  const autoRead = settings.voice.autoRead;
  const busy = listening || transcribing || speaking || status === 'processing' || status === 'responding';

  // Latest values for timers and intervals, which outlive a render.
  const live = useRef({});
  useEffect(() => {
    live.current = { status, speaking, listening, transcribing, speechDetected, autoRead, ttsSupported, followUp, replyId: lastReply?.id, start, stop };
  });

  const [windowOpen, setWindowOpen] = useState(false); // the follow-up window is running
  const [secondsLeft, setSecondsLeft] = useState(0);
  const wakeListenRef = useRef(false); // the current listen belongs to the wake flow
  // A wake message is out: its answer will open the window (see the poll below).
  const awaitRef = useRef({ active: false, baseReplyId: null, replyAt: 0, spoke: false, lastBusyAt: 0 });
  const windowTimerRef = useRef(null);
  const windowIdRef = useRef(0);

  const beginAwait = useCallback(() => {
    if (live.current.followUp <= 0) return;
    awaitRef.current = { active: true, baseReplyId: live.current.replyId, replyAt: 0, spoke: false, lastBusyAt: Date.now() };
  }, []);

  // Opens the window: the microphone listens for `followUp` seconds for the
  // user to start talking; if nobody does, it closes and the conversation ends.
  const openWindow = useCallback(() => {
    const seconds = live.current.followUp;
    const id = windowIdRef.current + 1;
    windowIdRef.current = id;
    setWindowOpen(true);
    setSecondsLeft(seconds);
    wakeListenRef.current = true;
    live.current.start();
    const deadline = Date.now() + seconds * 1000;
    const tick = window.setInterval(() => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    window.clearTimeout(windowTimerRef.current);
    windowTimerRef.current = window.setTimeout(() => {
      window.clearInterval(tick);
      setWindowOpen(false);
      // Someone already talking is let finish; otherwise the wait is over.
      if (windowIdRef.current === id && !live.current.speechDetected) live.current.stop({ silent: true });
    }, seconds * 1000);
  }, []);

  // A listen opened by the wake word sends itself when it ends; with nothing
  // said the conversation is over and Eddie goes back to waiting for the word.
  const wasListeningRef = useRef(false);
  useEffect(() => {
    if (wasListeningRef.current && !listening && wakeListenRef.current) {
      wakeListenRef.current = false;
      windowIdRef.current += 1; // a pending window timeout must not touch what comes next
      const text = `${transcript} ${interimTranscript}`.trim();
      if (text) {
        sendMessage(text);
        beginAwait();
      }
      reset();
    }
    wasListeningRef.current = listening;
  }, [listening, transcript, interimTranscript, sendMessage, reset, beginAwait]);

  // The browser's recognizer keeps going after the user stops talking; end the
  // listen after a short quiet. (Whisper has its own end-of-speech detection.)
  useEffect(() => {
    if (!listening || !wakeListenRef.current || sttEngine !== 'browser' || !(transcript || interimTranscript)) return undefined;
    const timer = window.setTimeout(() => stop(), END_OF_SPEECH_MS);
    return () => window.clearTimeout(timer);
  }, [listening, transcript, interimTranscript, sttEngine, stop]);

  // While the wake word is on: once the pending answer has arrived, been
  // spoken and gone quiet, open the window. Switching the wake word off (or
  // leaving) ends anything it had going.
  useEffect(() => {
    if (!enabled) return undefined;
    const poll = window.setInterval(() => {
      const s = live.current;
      const a = awaitRef.current;
      if (!a.active) return;
      if (s.status === 'error') {
        a.active = false;
        return;
      }
      if (!a.replyAt) {
        if (!s.replyId || s.replyId === a.baseReplyId) return;
        a.replyAt = Date.now();
      }
      if (s.speaking) a.spoke = true;
      if (s.status === 'processing' || s.status === 'responding' || s.speaking || s.listening || s.transcribing) {
        a.lastBusyAt = Date.now();
        return;
      }
      const willSpeak = s.autoRead && s.ttsSupported;
      if (willSpeak && !a.spoke && Date.now() - a.replyAt < SPEECH_GRACE_MS) return; // its voice hasn't started yet
      if (Date.now() - a.lastBusyAt < ECHO_TAIL_MS) return;
      a.active = false;
      openWindow();
    }, POLL_MS);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(windowTimerRef.current);
      awaitRef.current.active = false;
      windowIdRef.current += 1;
      setWindowOpen(false);
      if (wakeListenRef.current && live.current.listening) live.current.stop({ silent: true });
      wakeListenRef.current = false;
    };
  }, [enabled, openWindow]);

  const onWake = useCallback(
    (rest) => {
      // Like the ring: waking Eddie by voice means it answers by voice.
      if (!autoRead) updateVoiceSettings({ autoRead: true });
      if (rest) {
        sendMessage(rest);
        beginAwait();
        return;
      }
      if (!sttSupported) return;
      wakeListenRef.current = true;
      window.setTimeout(start, HANDOFF_MS);
    },
    [autoRead, updateVoiceSettings, sendMessage, beginAwait, sttSupported, start],
  );

  // The window is open, the microphone is listening and the user hasn't started yet.
  const waiting = enabled && windowOpen && listening && !speechDetected;
  const listener = useWakeWordListener({ enabled, word, lang, paused: busy, onWake });
  const value = useMemo(
    () => ({
      enabled,
      word,
      followUp,
      waiting,
      secondsLeft,
      supported: wakeWordSupported,
      status: listener.status,
      reason: listener.reason,
      heard: listener.heard,
      retry: listener.retry,
    }),
    [enabled, word, followUp, waiting, secondsLeft, listener.status, listener.reason, listener.heard, listener.retry],
  );

  return <WakeWordContext.Provider value={value}>{children}</WakeWordContext.Provider>;
}
