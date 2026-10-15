// The «Eddie» tab group of the extension (extension/group.js), against a small stand-in for chrome.tabs / chrome.tabGroups,
// and the rule that the extension and the server agree on the version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// ---------------- a fake browser ----------------
function fakeChrome({ failGroup = false } = {}) {
  const tabs = new Map(); // id → { id, windowId, groupId, pinned }
  const groups = new Map(); // id → { id, windowId, title, color, collapsed }
  let seq = 100;
  const api = {
    tabs: {
      get: async (id) => { if (!tabs.has(id)) throw new Error('No tab'); return { ...tabs.get(id) }; },
      query: async ({ active, windowId }) => [...tabs.values()].filter((t) => (!active || t.active) && (windowId == null || t.windowId === windowId)),
      group: async ({ tabIds, groupId, createProperties }) => {
        if (failGroup) throw new Error('boom');
        const id = groupId ?? (seq += 1);
        if (!groups.has(id)) groups.set(id, { id, windowId: createProperties?.windowId ?? tabs.get(tabIds[0]).windowId, title: '', color: 'grey', collapsed: false });
        for (const t of tabIds) tabs.get(t).groupId = id;
        return id;
      },
    },
    tabGroups: {
      query: async ({ windowId }) => [...groups.values()].filter((g) => g.windowId === windowId),
      get: async (id) => { if (!groups.has(id)) throw new Error('No group'); return { ...groups.get(id) }; },
      update: async (id, props) => { Object.assign(groups.get(id), props); return { ...groups.get(id) }; },
    },
  };
  const addTab = (props = {}) => { const t = { id: (seq += 1), windowId: 1, groupId: -1, pinned: false, active: false, ...props }; tabs.set(t.id, t); return t.id; };
  return { api, tabs, groups, addTab };
}
async function load(fake) {
  globalThis.chrome = fake.api;
  return import(`${root}/extension/group.js`);
}
const t = (name, fn) => test(name, fn);

t('a tab Eddie opens joins a cyan group called «✅ Eddie»', async () => {
  const f = fakeChrome();
  const G = await load(f);
  const tab = f.addTab();
  assert.equal(await G.joinGroup(tab), true);
  const [group] = [...f.groups.values()];
  assert.equal(group.title, '✅ Eddie');
  assert.equal(group.color, 'cyan');
  assert.equal(group.collapsed, false);
  assert.equal(f.tabs.get(tab).groupId, group.id);
});

t('the next tabs of the same window go into the same group; another window gets its own', async () => {
  const f = fakeChrome();
  const G = await load(f);
  const a = f.addTab();
  const b = f.addTab();
  const c = f.addTab({ windowId: 2 });
  await G.joinGroup(a);
  await G.joinGroup(b);
  await G.joinGroup(c);
  assert.equal(f.groups.size, 2);
  assert.equal(f.tabs.get(a).groupId, f.tabs.get(b).groupId);
  assert.notEqual(f.tabs.get(a).groupId, f.tabs.get(c).groupId);
});

t('a browser task shows «⏳ Eddie» while it works and «✅ Eddie» when it ends', async () => {
  const f = fakeChrome();
  const G = await load(f);
  const tab = f.addTab();
  await G.joinGroup(tab, 'working');
  assert.equal([...f.groups.values()][0].title, '⏳ Eddie');
  assert.equal(await G.setGroupStatus(tab, 'ready'), true);
  assert.equal([...f.groups.values()][0].title, '✅ Eddie');
  // a second tab joining while the title says «working» does not turn it back
  const other = f.addTab();
  await G.joinGroup(other, 'working');
  assert.equal([...f.groups.values()][0].title, '⏳ Eddie');
});

t('never touches what is the user\'s: pinned tabs and tabs in a group of their own stay where they are', async () => {
  const f = fakeChrome();
  const G = await load(f);
  const pinned = f.addTab({ pinned: true });
  assert.equal(await G.joinGroup(pinned), false);
  assert.equal(f.tabs.get(pinned).groupId, -1);
  // the user's own group
  f.groups.set(7, { id: 7, windowId: 1, title: 'Trabajo', color: 'red', collapsed: false });
  const mine = f.addTab({ groupId: 7 });
  assert.equal(await G.joinGroup(mine), false);
  assert.equal(f.tabs.get(mine).groupId, 7);
  assert.equal(f.groups.get(7).title, 'Trabajo', 'and their group is not renamed');
  // setGroupStatus only touches Eddie's group
  assert.equal(await G.setGroupStatus(mine, 'ready'), false);
  assert.equal(f.groups.get(7).title, 'Trabajo');
  assert.equal(await G.setGroupStatus(f.addTab(), 'ready'), false, 'a tab with no group');
});

t('a tab already in Eddie\'s group stays and only the title is refreshed', async () => {
  const f = fakeChrome();
  const G = await load(f);
  const tab = f.addTab();
  await G.joinGroup(tab, 'working');
  assert.equal(await G.joinGroup(tab, 'ready'), true);
  assert.equal(f.groups.size, 1);
  assert.equal([...f.groups.values()][0].title, '✅ Eddie');
});

t('the side panel: the tab in front of the window joins; with no active tab nothing happens', async () => {
  const f = fakeChrome();
  const G = await load(f);
  f.addTab({ active: false });
  const front = f.addTab({ active: true });
  assert.equal(await G.joinFrontTab(1), true);
  assert.equal(f.tabs.get(front).groupId, [...f.groups.keys()][0]);
  assert.equal(await G.joinFrontTab(9), false);
});

t('a browser that refuses (no such API, a closed tab, an error) never breaks what the tab was opened for', async () => {
  const f = fakeChrome({ failGroup: true });
  const G = await load(f);
  assert.equal(await G.joinGroup(f.addTab()), false);
  assert.equal(await G.joinGroup(9999), false, 'a tab that is gone');
  const noApi = { tabs: f.api.tabs };
  globalThis.chrome = noApi; // an old browser without tabGroups
  assert.equal(await G.joinGroup(1), false);
  assert.equal(await G.setGroupStatus(1, 'ready'), false);
  assert.equal(await G.joinFrontTab(1), false);
});

t('the manifest asks for tabGroups, and the extension and the server agree on the version', async () => {
  const manifest = JSON.parse(readFileSync(`${root}/extension/manifest.json`, 'utf8'));
  assert.ok(manifest.permissions.includes('tabGroups'));
  const { EXTENSION_VERSION } = await import(`${root}/api/_lib/browser/open.js`);
  assert.equal(manifest.version, EXTENSION_VERSION);
  // nothing in the grouping reads a page: the manifest still gives no extra site access for it
  assert.deepEqual(manifest.host_permissions, ['https://eddie-asistent.vercel.app/*']);
});
