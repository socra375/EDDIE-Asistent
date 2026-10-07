import { useEffect, useRef, useState } from 'react';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { AuthProvider } from './context/AuthContext';
import { LocationProvider } from './context/LocationContext';
import { VoiceProvider, useVoice } from './context/VoiceContext';
import { ChatProvider, useChat } from './context/ChatContext';
import HudFx from './layout/HudFx';
import IconRail from './layout/IconRail';
import { moduleLabel } from './layout/modules';
import ChatList from './layout/ChatList';
import Header from './layout/Header';
import ChatPanel from './components/Chat/ChatPanel';
import HomePanel from './home/HomePanel';
import TasksPanel from './components/Tasks/TasksPanel';
import SettingsPanel from './components/Settings/SettingsPanel';
import ConnectorsPanel from './connectors/ConnectorsPanel';
import TodayPanel from './today/TodayPanel';
import MemoryPanel from './memory/MemoryPanel';
import GalleryPanel from './gallery/GalleryPanel';
import YouTubePlayer from './player/YouTubePlayer';
import { WakeWordProvider } from './context/WakeWordContext';
import { NotesProvider } from './context/NotesContext';
import NotesPanel from './notes/NotesPanel';
import { NOTES_EVENT } from './services/notesBridge';
import { VisionProvider } from './context/VisionContext';
import { HudProvider } from './context/HudContext';
import { VIGILANCE_EVENT } from './services/visionBridge';
import { HUD_EVENT } from './services/hudBridge';
import { readLaunch } from './services/pwa';
import SettingsSyncBridge from './components/Shared/SettingsSyncBridge';
import BootSplash from './boot/BootSplash';
import DeviceBridge from './devices/DeviceBridge';
import RemoteViewer from './devices/RemoteViewer';
import { isLite, PERF_CHANGED_EVENT, readGuard, watchFrameRate, writeGuard } from './services/performance';
import './layout/Layout.css';

const FILLERS = ['Un momento, lo reviso.', 'Déjame ver.', 'Dame un segundo.', 'Ahora mismo lo miro.'];
const FILLER_AFTER_MS = 1500;
const FILLER_MAX_MS = 6000;

// Reads Eddie's answers aloud when the voice is on. An answer that streams in
// is spoken sentence by sentence while it is still being written; anything
// that arrives whole (small talk, the probe, an error) is read in one go.
function AutoReadBridge() {
  const { messages, status, lastReply, liveSteps } = useChat();
  const { speakWithSettings, streamWithSettings } = useVoice();
  const { settings } = useSettings();
  const autoRead = settings.voice.autoRead;
  const streamRef = useRef(null); // { id, controller }
  // A short "un momento" said while tools run (see below); the answer waits
  // for it to end instead of cutting it off.
  const fillerRef = useRef({ spoken: false, busy: false, pending: null });
  const [fillerTick, setFillerTick] = useState(0);

  // The answer being written: the last message while Eddie is responding.
  const writing = status === 'responding' ? messages.at(-1) : null;
  const writingId = writing?.role === 'assistant' && !writing.isError ? writing.id : null;
  const writingText = writingId ? writing.content : '';
  useEffect(() => {
    if (!autoRead || !writingId || fillerRef.current.busy) return;
    if (streamRef.current?.id !== writingId) streamRef.current = { id: writingId, controller: streamWithSettings() };
    streamRef.current.controller.push(writingText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingId, writingText, autoRead, fillerTick]);

  // The answer is complete: finish the stream, or read it whole if it never streamed.
  useEffect(() => {
    if (!lastReply || !autoRead) return;
    const stream = streamRef.current;
    if (stream?.id === lastReply.id) {
      stream.controller.end(lastReply.content);
      streamRef.current = null;
    } else if (fillerRef.current.busy) {
      fillerRef.current.pending = lastReply;
    } else {
      speakWithSettings(lastReply.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReply]);

  // An answer that failed half-way: say what was already written, not the error.
  useEffect(() => {
    if (status !== 'error' || !streamRef.current) return;
    streamRef.current.controller.end();
    streamRef.current = null;
  }, [status]);

  // Tools take a few seconds with nothing to hear: after 1.5 s of them
  // running, Eddie says one short line (Spanish only, once per turn).
  const working = status === 'processing' && liveSteps.length > 0;
  useEffect(() => {
    if (!liveSteps.length) fillerRef.current.spoken = false;
  }, [liveSteps.length]);
  useEffect(() => {
    const filler = fillerRef.current;
    if (!autoRead || !working || filler.spoken || settings.language !== 'es') return undefined;
    const timer = setTimeout(() => {
      filler.spoken = true;
      filler.busy = true;
      const line = FILLERS[Math.floor(Math.random() * FILLERS.length)];
      // Called when the line ends — or after FILLER_MAX_MS if it never does
      // (audio blocked, stopped by something else) — so the answer is never held back.
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(failsafe);
        filler.busy = false;
        if (filler.pending) {
          const reply = filler.pending;
          filler.pending = null;
          speakWithSettings(reply.content);
        } else {
          setFillerTick((n) => n + 1);
        }
      };
      const failsafe = setTimeout(release, FILLER_MAX_MS);
      speakWithSettings(line, release, { filler: true });
    }, FILLER_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, autoRead]);

  return null;
}

// "Modo ligero": marks the page (data-perf="lite") when the effects should be
// off — by the user's choice, or in "auto" when the device is small or the
// screen was seen running slowly (see services/performance.js).
function PerfBridge() {
  const { settings } = useSettings();
  const mode = settings.display?.perf || 'auto';
  const [guard, setGuard] = useState(readGuard);
  const lite = isLite(mode, guard);

  useEffect(() => {
    if (lite) document.documentElement.dataset.perf = 'lite';
    else delete document.documentElement.dataset.perf;
  }, [lite]);

  const core = settings.display?.core || 'cyan';
  useEffect(() => {
    if (core === 'cyan') delete document.documentElement.dataset.core;
    else document.documentElement.dataset.core = core;
  }, [core]);

  useEffect(() => {
    const sync = () => setGuard(readGuard());
    window.addEventListener(PERF_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PERF_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (mode !== 'auto' || lite) return undefined;
    return watchFrameRate(() => {
      writeGuard(true);
      setGuard(true);
    });
  }, [mode, lite]);

  return null;
}

// Below this width "Mis chats" slides over the content instead of taking a
// column, so it closes itself once the user picks something.
const NARROW_QUERY = '(max-width: 1100px)';

// Back from Google or Spotify after "Conectar Gmail" / "Conectar Spotify": ?connected=gmail, or
// ?google_error=…&connect=gmail (?connect_error=… for Spotify). Read once, then removed from the address.
function readConnectReturn() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const connector = connected || params.get('connect');
  if (!connector || !/^[a-z0-9_-]{1,40}$/.test(connector)) return null;
  return connected ? { type: 'connected', connector } : { type: 'error', connector, error: params.get('google_error') || params.get('connect_error') || 'error' };
}

function AppShell() {
  const [connectReturn] = useState(readConnectReturn);
  // Where the installed app's shortcuts (and links like /?modulo=tareas) open.
  const [launch] = useState(readLaunch);
  const [activeModule, setActiveModule] = useState(() => (connectReturn ? 'connectors' : launch.module || 'home'));

  useEffect(() => {
    if (connectReturn || launch.module || launch.action) window.history.replaceState(null, '', window.location.pathname);
    // "Modo Vigilancia" shortcut: the camera card listens from the next tick on.
    if (launch.action === 'vigilancia') {
      const timer = window.setTimeout(() => window.dispatchEvent(new CustomEvent(VIGILANCE_EVENT, { detail: { action: 'on' } })), 300);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [connectReturn, launch]);
  const [chatListOpen, setChatListOpen] = useState(false);

  // "Modo Vigilancia" by voice or text: the camera panel lives in Inicio.
  useEffect(() => {
    const goHome = (e) => {
      if (e.detail?.action === 'on') setActiveModule('home');
    };
    window.addEventListener(VIGILANCE_EVENT, goHome);
    return () => window.removeEventListener(VIGILANCE_EVENT, goHome);
  }, []);

  // "Activa sistema" / "Dame los datos de hoy": the panels live in Inicio.
  useEffect(() => {
    const goHome = (e) => {
      if (e.detail?.action === 'show' || e.detail?.action === 'today') setActiveModule('home');
    };
    window.addEventListener(HUD_EVENT, goHome);
    return () => window.removeEventListener(HUD_EVENT, goHome);
  }, []);

  // A notification was tapped while Eddie is open (public/sw.js): go where it points.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (e) => {
      if (e.data?.type !== 'eddie:open') return;
      const { module } = readLaunch(typeof e.data.search === 'string' ? e.data.search : '');
      if (module) setActiveModule(module);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // "Toma notas…" / "abre mis notas": the sheet is in Notas.
  useEffect(() => {
    const goNotes = (e) => {
      if (e.detail?.action === 'show') setActiveModule('notes');
    };
    window.addEventListener(NOTES_EVENT, goNotes);
    return () => window.removeEventListener(NOTES_EVENT, goNotes);
  }, []);

  function closeListIfNarrow() {
    if (window.matchMedia(NARROW_QUERY).matches) setChatListOpen(false);
  }

  function selectModule(id) {
    setActiveModule(id);
    closeListIfNarrow();
  }

  function openChat() {
    setActiveModule('chat');
    closeListIfNarrow();
  }

  useEffect(() => {
    if (!chatListOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && closeListIfNarrow();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatListOpen]);

  return (
    <div className={`app-shell ${chatListOpen ? '' : 'app-shell--list-closed'}`}>
      <HudFx />
      <IconRail
        active={activeModule}
        onSelect={selectModule}
        chatListOpen={chatListOpen}
        onToggleChatList={() => setChatListOpen((open) => !open)}
      />
      <ChatList onOpenChat={openChat} />
      {chatListOpen && <div className="chatlist-backdrop" onClick={() => setChatListOpen(false)} aria-hidden="true" />}
      <div className="app-main">
        <Header section={moduleLabel(activeModule)} />
        <main className="app-content">
          {activeModule === 'home' && <HomePanel onOpenTasks={() => setActiveModule('tasks')} focusOrb={launch.action === 'hablar'} />}
          {activeModule === 'today' && (
            <TodayPanel onOpenTasks={() => setActiveModule('tasks')} onOpenConnectors={() => setActiveModule('connectors')} onOpenChat={openChat} />
          )}
          {activeModule === 'chat' && <ChatPanel />}
          {activeModule === 'tasks' && <TasksPanel />}
          {activeModule === 'notes' && <NotesPanel />}
          {activeModule === 'memory' && <MemoryPanel />}
          {activeModule === 'gallery' && <GalleryPanel />}
          {activeModule === 'connectors' && <ConnectorsPanel notice={connectReturn} />}
          {activeModule === 'settings' && <SettingsPanel onOpenConversation={() => setActiveModule('chat')} />}
        </main>
      </div>
      <YouTubePlayer />
      <AutoReadBridge />
      <PerfBridge />
      <SettingsSyncBridge />
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <LocationProvider>
          <VoiceProvider>
            <ChatProvider>
              <NotesProvider>
                <WakeWordProvider>
                  <VisionProvider>
                    <HudProvider>
                      <AppShell />
                      <DeviceBridge />
                      <RemoteViewer />
                      {/* Outside the app shell, whose children are all made `position: relative`. */}
                      <BootSplash />
                    </HudProvider>
                  </VisionProvider>
                </WakeWordProvider>
              </NotesProvider>
            </ChatProvider>
          </VoiceProvider>
        </LocationProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
