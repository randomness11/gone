import type { RawTab } from '../types';

export function isChromeExtension(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

export async function hasTabsPermission(): Promise<boolean> {
  if (!isChromeExtension()) return false;
  return chrome.permissions.contains({ permissions: ['tabs'] });
}

export async function hasFaviconPermission(): Promise<boolean> {
  if (!isChromeExtension()) return false;
  return chrome.permissions.contains({ permissions: ['favicon'] });
}

export async function requestAnalysisPermission(modelBaseUrl?: string): Promise<boolean> {
  if (!isChromeExtension()) return true;

  const request: chrome.permissions.Permissions = { permissions: ['tabs', 'favicon'] };
  if (modelBaseUrl) {
    try {
      const origin = new URL(modelBaseUrl).origin;
      if (origin.startsWith('http://') || origin.startsWith('https://')) {
        request.origins = [`${origin}/*`];
      }
    } catch {
      // The provider will surface an actionable URL error later.
    }
  }
  return chrome.permissions.request(request);
}

export async function collectCurrentTabs(): Promise<RawTab[]> {
  if (!isChromeExtension()) return [];
  const tabs = await chrome.tabs.query({});
  const extensionOrigin = chrome.runtime.getURL('');
  return tabs.filter((tab) => !tab.url?.startsWith(extensionOrigin)).map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    windowId: tab.windowId,
    groupId: tab.groupId,
    index: tab.index,
    active: tab.active,
    pinned: tab.pinned,
    openerTabId: tab.openerTabId,
    lastAccessed: tab.lastAccessed,
  }));
}

export async function closeTabsByBrowserId(ids: number[]): Promise<void> {
  if (!isChromeExtension() || ids.length === 0) return;
  await chrome.tabs.remove(ids);
}

export async function activateBrowserTab(id: number): Promise<void> {
  if (!isChromeExtension()) return;
  const tab = await chrome.tabs.update(id, { active: true });
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

export async function focusBrowserTabs(ids: number[], title: string): Promise<number | undefined> {
  if (!isChromeExtension() || ids.length === 0) return undefined;
  const granted = await chrome.permissions.request({ permissions: ['tabs', 'tabGroups'] });
  if (!granted) throw new Error('Tab grouping permission was not granted.');
  const groupId = await chrome.tabs.group({ tabIds: ids });
  await chrome.tabGroups.update(groupId, { title: title.slice(0, 28), color: 'blue', collapsed: false });
  await chrome.tabs.update(ids[0], { active: true });
  return groupId;
}
