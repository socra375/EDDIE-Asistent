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

function AppShell() {
  const [activeModule, setActiveModule] = useState('home');
  const [chatListOpen, setChatListOpen] = useState(false);

  return (
    <div className={`app-shell ${chatListOpen ? '' : 'app-shell--list-closed'}`}>
      <HudFx />
      <IconRail
        active={activeModule}
        onSelect={setActiveModule}
        chatListOpen={chatListOpen}
        onToggleChatList={() => setChatListOpen((open) => !open)}
      />
      <ChatList onOpenChat={() => setActiveModule('chat')} />
      <div className="app-main">
        <Header section={moduleLabel(activeModule)} />
        <main className="app-content">
          {activeModule === 'home' && <HomePanel onOpenTasks={() => setActiveModule('tasks')} />}
          {activeModule === 'chat' && <ChatPanel />}
          {activeModule === 'tasks' && <TasksPanel />}
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
