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
import YouTubePlayer from './player/YouTubePlayer';
import { WakeWordProvider } from './context/WakeWordContext';
import SettingsSyncBridge from './components/Shared/SettingsSyncBridge';
import { isLite, PERF_CHANGED_EVENT, readGuard, watchFrameRate, writeGuard } from './services/performance';
import './layout/Layout.css';

// Reads Eddie's answers aloud when the voice is on. An answer that streams in
// is spoken sentence by sentence while it is still being written; anything
// that arrives whole (small talk, the probe, an error) is read in one go.
function AutoReadBridge() {
  const { messages, status, lastReply } = useChat();
  const { speakWithSettings, streamWithSettings } = useVoice();
  const { settings } = useSettings();
  const autoRead = settings.voice.autoRead;
  const streamRef = useRef(null); // { id, controller }

  // The answer being written: the last message while Eddie is responding.
  const writing = status === 'responding' ? messages.at(-1) : null;
  const writingId = writing?.role === 'assistant' && !writing.isError ? writing.id : null;
  const writingText = writingId ? writing.content : '';
  useEffect(() => {
    if (!autoRead || !writingId) return;
    if (streamRef.current?.id !== writingId) streamRef.current = { id: writingId, controller: streamWithSettings() };
    streamRef.current.controller.push(writingText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingId, writingText, autoRead]);

  // The answer is complete: finish the stream, or read it whole if it never streamed.
  useEffect(() => {
    if (!lastReply || !autoRead) return;
    const stream = streamRef.current;
    if (stream?.id === lastReply.id) {
      stream.controller.end(lastReply.content);
      streamRef.current = null;
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

// Back from Google after "Conectar Gmail": ?connected=gmail, or
// ?google_error=…&connect=gmail. Read once, then removed from the address.
function readConnectReturn() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const connector = connected || params.get('connect');
  if (!connector || !/^[a-z0-9_-]{1,40}$/.test(connector)) return null;
  return connected ? { type: 'connected', connector } : { type: 'error', connector, error: params.get('google_error') || 'error' };
}

function AppShell() {
  const [connectReturn] = useState(readConnectReturn);
  const [activeModule, setActiveModule] = useState(() => (connectReturn ? 'connectors' : 'home'));

  useEffect(() => {
    if (connectReturn) window.history.replaceState(null, '', window.location.pathname);
  }, [connectReturn]);
  const [chatListOpen, setChatListOpen] = useState(false);

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
          {activeModule === 'home' && <HomePanel onOpenTasks={() => setActiveModule('tasks')} />}
          {activeModule === 'today' && (
            <TodayPanel onOpenTasks={() => setActiveModule('tasks')} onOpenConnectors={() => setActiveModule('connectors')} onOpenChat={openChat} />
          )}
          {activeModule === 'chat' && <ChatPanel />}
          {activeModule === 'tasks' && <TasksPanel />}
          {activeModule === 'memory' && <MemoryPanel />}
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
              <WakeWordProvider>
                <AppShell />
              </WakeWordProvider>
            </ChatProvider>
          </VoiceProvider>
        </LocationProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
