// Stopwatch for one spoken exchange, so the real delays can be seen in
// Configuración → Voz instead of guessed. Marks are taken along the way:
//   recordEnd   the user stopped talking (the recording ended)
//   transcript  the text of what they said is ready
//   send        the message left for Eddie
//   firstToken  the first words of the answer arrived
//   audioStart  Eddie's voice started playing
// Typed messages have no recordEnd/transcript; the figures that can't be
// computed are simply left out.
import { useEffect, useState } from 'react';

export const VOICE_TIMING_EVENT = 'eddie:voice-timing';
const ORDER = ['recordEnd', 'transcript', 'send', 'firstToken', 'audioStart'];
let marks = {};

function emit() {
  window.dispatchEvent(new CustomEvent(VOICE_TIMING_EVENT));
}

// Starting a new exchange (recordEnd, or send without a recording) clears the old marks.
export function markVoice(name, now = performance.now()) {
  if (!ORDER.includes(name)) return;
  const startsNew = name === 'recordEnd' || (name === 'send' && (marks.send !== undefined || marks.transcript === undefined));
  if (startsNew) marks = {};
  // Later marks only count once; "audioStart" would otherwise move with every sentence.
  if (marks[name] === undefined) marks[name] = now;
  emit();
}

const seconds = (from, to) => (marks[from] !== undefined && marks[to] !== undefined && marks[to] >= marks[from] ? (marks[to] - marks[from]) / 1000 : null);

// { transcribe, firstToken, firstVoice, total } in seconds (null when unknown).
export function voiceTimings() {
  return {
    transcribe: seconds('recordEnd', 'transcript'),
    firstToken: seconds('send', 'firstToken'),
    firstVoice: seconds('send', 'audioStart'),
    total: seconds('recordEnd', 'audioStart') ?? seconds('send', 'audioStart'),
  };
}

export function useVoiceTimings() {
  const [timings, setTimings] = useState(voiceTimings);
  useEffect(() => {
    const update = () => setTimings(voiceTimings());
    window.addEventListener(VOICE_TIMING_EVENT, update);
    return () => window.removeEventListener(VOICE_TIMING_EVENT, update);
  }, []);
  return timings;
}

export function formatSeconds(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)} s`;
}
