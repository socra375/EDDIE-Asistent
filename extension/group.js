// "Eddie" in the tab strip: every tab Eddie is working with sits in a colored tab group called «Eddie», so the user can
// see at a glance which tabs are Eddie's and close or ungroup them in one click. The title says what he is doing:
// «⏳ Eddie» while a browser task runs in the group, «✅ Eddie» the rest of the time.
//
// What goes in: a page Eddie opens (a document he made, a link he was asked for, a meeting), the tab of a browser task,
// and the tab in front when the user opens Eddie's side panel. What never goes in: a pinned tab, or a tab the user
// already put in a group of their own (Eddie never takes a tab out of it).
//
// Only the browser's tab and tab-group API is used (is it pinned? which group? which window?): no address, title or
// content of any page is read for this.
const COLOR = 'cyan';
export const TITLES = { working: '⏳ Eddie', ready: '✅ Eddie' };
const NO_GROUP = -1;

const isEddie = (group) => Object.values(TITLES).includes(group?.title);

// Puts the tab in Eddie's group of its window (made if there is none) and sets the title for `status`
// ('ready' | 'working'). → true if the tab is in the group afterwards. Never throws: the group is a nicety, and the tab
// has already done what it was opened for.
export async function joinGroup(tabId, status = 'ready') {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.pinned) return false;
    const mine = (await chrome.tabGroups.query({ windowId: tab.windowId })).find(isEddie);
    if (tab.groupId !== NO_GROUP && tab.groupId !== mine?.id) return false; // the user's own group
    let groupId = mine?.id;
    if (groupId == null) groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
    else if (tab.groupId !== groupId) await chrome.tabs.group({ groupId, tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: TITLES[status] || TITLES.ready, color: COLOR, collapsed: false });
    return true;
  } catch {
    return false;
  }
}

// Changes the title of the tab's group to `status`, only if it is Eddie's.
export async function setGroupStatus(tabId, status) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.groupId === NO_GROUP) return false;
    const group = await chrome.tabGroups.get(tab.groupId);
    if (!isEddie(group)) return false;
    await chrome.tabGroups.update(group.id, { title: TITLES[status] || TITLES.ready });
    return true;
  } catch {
    return false;
  }
}

// Whether the tab is still one of Eddie's: in his group, not pinned. A page Eddie opened for a moment is only closed when
// it still is (the user keeps one by dragging it out of the group, or by pinning it).
export async function isEddieTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.pinned || tab.groupId === NO_GROUP) return false;
    return isEddie(await chrome.tabGroups.get(tab.groupId));
  } catch {
    return false;
  }
}

// The tab in front in a window, in Eddie's group (when his side panel opens on it).
export async function joinFrontTab(windowId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    return tab?.id != null ? await joinGroup(tab.id, 'ready') : false;
  } catch {
    return false;
  }
}
