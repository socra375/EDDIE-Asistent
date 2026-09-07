import { useEffect, useState } from 'react';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { AuthProvider } from './context/AuthContext';
import { VoiceProvider, useVoice } from './context/VoiceContext';
import { ChatProvider, useChat } from './context/ChatContext';
import Sidebar, { MODULES } from './components/Layout/Sidebar';
import TopBar from './components/Layout/TopBar';
import ChatPanel from './components/Chat/ChatPanel';
import VoicePanel from './components/Voice/VoicePanel';
import StudyPanel from './components/Study/StudyPanel';
import CodePanel from './components/Code/CodePanel';
import TasksPanel from './components/Tasks/TasksPanel';
import DocumentsPanel from './components/Documents/DocumentsPanel';
import SettingsPanel from './components/Settings/SettingsPanel';
import SettingsSyncBridge from './components/Shared/SettingsSyncBridge';
import './App.css';

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
  const { settings, updateSettings } = useSettings();
  const { status } = useChat();

  const activeMeta = MODULES.find((m) => m.id === activeModule);

  function toggleTheme() {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  }

  return (
    <div className="app-shell">
      <Sidebar active={activeModule} onSelect={setActiveModule} />
      <div className="app-main">
        <TopBar title={activeMeta?.label || 'Eddie'} status={status} theme={settings.theme} onToggleTheme={toggleTheme} />
        <div className="app-content">
          {activeModule === 'chat' && <ChatPanel />}
          {activeModule === 'voice' && <VoicePanel />}
          {activeModule === 'study' && <StudyPanel />}
          {activeModule === 'code' && <CodePanel />}
          {activeModule === 'tasks' && <TasksPanel />}
          {activeModule === 'documents' && <DocumentsPanel />}
          {activeModule === 'settings' && <SettingsPanel />}
        </div>
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
        <VoiceProvider>
          <ChatProvider>
            <AppShell />
          </ChatProvider>
        </VoiceProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
