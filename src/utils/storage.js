// Small localStorage wrapper. Every read/write is guarded so a disabled or
// full storage never crashes the app — it just behaves as if memory is empty.

const KEYS = {
  settings: 'eddie.settings',
  memory: 'eddie.memory',
  conversation: 'eddie.conversation',
  tasks: 'eddie.tasks',
};

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
    voiceURI: '',
    rate: 1,
    pitch: 0.9,
    volume: 1,
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

export function getConversation() {
  return read(KEYS.conversation, []);
}

export function saveConversation(messages) {
  write(KEYS.conversation, messages);
}

export function clearConversation() {
  write(KEYS.conversation, []);
}

export function getTasks() {
  return read(KEYS.tasks, []);
}

export function saveTasks(tasks) {
  write(KEYS.tasks, tasks);
}
