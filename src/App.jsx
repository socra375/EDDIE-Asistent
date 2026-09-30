import { useEffect, useState } from 'react';
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
import SettingsSyncBridge from './components/Shared/SettingsSyncBridge';
import './layout/Layout.css';

function AutoReadBridge() {
  const { lastReply } = useChat();
  const { speakWithSettings } = useVoice();
  const { settings } = useSettings();

  useEffect(() => {
    if (lastReply && settings.voice.autoRead) {
      speakWithSettings(lastReply.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReply]);

  return null;
}

// Below this width "Mis chats" slides over the content instead of taking a
// column, so it closes itself once the user picks something.
const NARROW_QUERY = '(max-width: 1100px)';

function AppShell() {
  const [activeModule, setActiveModule] = useState('home');
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
          {activeModule === 'chat' && <ChatPanel />}
          {activeModule === 'tasks' && <TasksPanel />}
          {activeModule === 'connectors' && <ConnectorsPanel />}
          {activeModule === 'settings' && <SettingsPanel onOpenConversation={() => setActiveModule('chat')} />}
        </main>
      </div>
      <AutoReadBridge />
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
              <AppShell />
            </ChatProvider>
          </VoiceProvider>
        </LocationProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
