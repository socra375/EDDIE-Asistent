// Small localStorage wrapper. Every read/write is guarded so a disabled or
// full storage never crashes the app — it just behaves as if memory is empty.

const KEYS = {
  settings: 'eddie.settings',
  memory: 'eddie.memory',
  conversations: 'eddie.conversations',
  activeConversationId: 'eddie.activeConversationId',
  tasks: 'eddie.tasks',
};

// Read from before multi-conversation history existed, so an upgrading
// user's in-progress chat isn't silently lost.
const LEGACY_CONVERSATION_KEY = 'eddie.conversation';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_SETTINGS = {
  provider: 'gemini',
  model: '',
  language: 'es',
  theme: 'dark',
  memoryEnabled: true,
  voice: {
    autoRead: false,
  },
};

export function getSettings() {
  const stored = read(KEYS.settings, null);
  if (!stored) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...stored, voice: { ...DEFAULT_SETTINGS.voice, ...(stored.voice || {}) } };
}

export function saveSettings(settings) {
  write(KEYS.settings, settings);
}

export function getMemory() {
  return read(KEYS.memory, {});
}

export function saveMemory(memory) {
  write(KEYS.memory, memory);
}

export function updateMemoryField(key, value) {
  const memory = getMemory();
  memory[key] = value;
  saveMemory(memory);
  return memory;
}

export function deleteMemoryField(key) {
  const memory = getMemory();
  delete memory[key];
  saveMemory(memory);
  return memory;
}

export function clearMemory() {
  write(KEYS.memory, {});
}

// A short, human-readable label for a conversation: the first thing the
// user actually said, so the history list reads like a list of topics
// instead of a list of timestamps.
export function conversationTitle(messages) {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  const text = firstUserMessage?.content?.trim() || 'Conversación';
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function getConversations() {
  const stored = read(KEYS.conversations, null);
  if (stored) return stored;

  const legacy = read(LEGACY_CONVERSATION_KEY, []);
  if (legacy.length === 0) return [];

  const migrated = [
    {
      id: 'legacy',
      title: conversationTitle(legacy),
      messages: legacy,
      createdAt: legacy[0]?.timestamp || Date.now(),
      updatedAt: legacy[legacy.length - 1]?.timestamp || Date.now(),
    },
  ];
  write(KEYS.conversations, migrated);
  return migrated;
}

export function saveConversations(conversations) {
  write(KEYS.conversations, conversations);
}

export function getActiveConversationId() {
  return read(KEYS.activeConversationId, null);
}

export function setActiveConversationId(id) {
  write(KEYS.activeConversationId, id);
}

export function getTasks() {
  return read(KEYS.tasks, []);
}

export function saveTasks(tasks) {
  write(KEYS.tasks, tasks);
}
