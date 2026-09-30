import { useEffect, useState } from 'react';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { AuthProvider } from './context/AuthContext';
import { LocationProvider } from './context/LocationContext';
import { VoiceProvider, useVoice } from './context/VoiceContext';
import { ChatProvider, useChat } from './context/ChatContext';
import IconRail from './layout/IconRail';
import { moduleLabel } from './layout/modules';
import ChatList from './layout/ChatList';
import Header from './layout/Header';
import ChatPanel from './components/Chat/ChatPanel';
import StudyPanel from './components/Study/StudyPanel';
import CodePanel from './components/Code/CodePanel';
import TasksPanel from './components/Tasks/TasksPanel';
import DocumentsPanel from './components/Documents/DocumentsPanel';
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
  const [activeModule, setActiveModule] = useState('chat');
  const [chatListOpen, setChatListOpen] = useState(true);
  const { status } = useChat();

  return (
    <div className={`app-shell ${chatListOpen ? '' : 'app-shell--list-closed'}`}>
      <IconRail
        active={activeModule}
        onSelect={setActiveModule}
        chatListOpen={chatListOpen}
        onToggleChatList={() => setChatListOpen((open) => !open)}
      />
      <ChatList onOpenChat={() => setActiveModule('chat')} />
      <div className="app-main">
        <Header section={moduleLabel(activeModule)} status={status} />
        <main className="app-content">
          {activeModule === 'chat' && <ChatPanel />}
          {activeModule === 'study' && <StudyPanel />}
          {activeModule === 'code' && <CodePanel />}
          {activeModule === 'tasks' && <TasksPanel />}
          {activeModule === 'documents' && <DocumentsPanel />}
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
