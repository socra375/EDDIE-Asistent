// Backend calls for signed-in users: tasks/settings/memory persisted in
// Postgres instead of (or alongside) localStorage, plus the Google
// Calendar/Drive integrations. Every call is scoped server-side to the
// caller's session — never trust anything here to fail closed on its own.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) return null; // not logged in — caller falls back to local-only
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `El servidor respondió con un error (${res.status}).`);
  }
  return data;
}

export const remoteTasks = {
  list: () => request('/api/tasks'),
  create: (task) => request('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),
  update: (id, patch) => request(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
};

export const remoteSettings = {
  get: () => request('/api/settings'),
  put: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
};

export const remoteMemory = {
  get: () => request('/api/memory'),
  put: (data) => request('/api/memory', { method: 'PUT', body: JSON.stringify(data) }),
  clear: () => request('/api/memory', { method: 'DELETE' }),
};

export const remoteCalendar = {
  createEventFromTask: (task) =>
    request('/api/calendar/events', { method: 'POST', body: JSON.stringify({ title: task.title, dueDate: task.dueDate }) }),
};

export const remoteDrive = {
  save: (filename, content, mimeType) => request('/api/drive/save', { method: 'POST', body: JSON.stringify({ filename, content, mimeType }) }),
};
