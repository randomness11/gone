import { transitionAttention } from '../lib/attention';
import { buildSnapshotDigest, compareSnapshotDigests } from '../lib/live';
import { buildLocalAnalysis } from '../lib/localAnalysis';
import { preprocessTabs } from '../lib/preprocessing';
import { redactText, sanitizeUrl } from '../lib/privacy';
import {
  ensureLiveReflectionAutostart,
  loadAttentionLedger,
  loadCurrentSession,
  loadLiveStatus,
  loadSnapshotDigest,
  saveLiveStatus,
  saveAttentionLedger,
  saveSession,
  saveSnapshotDigest,
} from '../lib/storage';
import { collectCurrentTabs, hasTabsPermission } from '../lib/tabs';
import type { PreprocessedTabs } from '../types';

const DASHBOARD_PATH = 'dashboard.html';
const LIVE_ALARM = 'tabscope.live-reflection';
const RETIRED_ATTENTION_ALARM = 'tabscope.attention-cycle';
const ATTENTION_ALARM = 'tabscope.attention-checkpoint';

let attentionQueue = Promise.resolve();

function queueAttention(work: () => Promise<void>): void {
  attentionQueue = attentionQueue.then(work, work).catch(() => undefined);
}

async function recordAttention(tab?: chrome.tabs.Tab): Promise<void> {
  const now = Date.now();
  const ledger = await loadAttentionLedger();
  if (!tab?.id || tab.windowId === chrome.windows.WINDOW_ID_NONE) {
    await saveAttentionLedger(transitionAttention(ledger, undefined, now));
    return;
  }
  const sanitized = sanitizeUrl(tab.url);
  const extensionOrigin = chrome.runtime.getURL('');
  const eligible = !sanitized.unsupported && !tab.url?.startsWith(extensionOrigin);
  await saveAttentionLedger(transitionAttention(ledger, eligible ? {
    tabId: tab.id,
    windowId: tab.windowId,
    domain: sanitized.domain,
    title: redactText(tab.title || sanitized.domain),
  } : undefined, now));
}

async function focusedActiveTab(windowId?: number): Promise<chrome.tabs.Tab | undefined> {
  const focusedWindow = windowId === undefined
    ? await chrome.windows.getLastFocused()
    : await chrome.windows.get(windowId);
  if (!focusedWindow.focused || focusedWindow.id === undefined) return undefined;
  const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });
  return tab;
}

async function checkpointAttention(): Promise<void> {
  const permission = await hasTabsPermission();
  if (!permission) {
    const ledger = await loadAttentionLedger();
    if (ledger?.active) await saveAttentionLedger(transitionAttention(ledger, undefined));
    return;
  }
  await recordAttention(await focusedActiveTab());
}

async function syncAttentionAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ATTENTION_ALARM);
  if (!existing || existing.periodInMinutes !== 1) {
    await chrome.alarms.create(ATTENTION_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
  }
}

async function syncLiveAlarm(): Promise<void> {
  await chrome.alarms.clear(RETIRED_ATTENTION_ALARM);
  const settings = await ensureLiveReflectionAutostart();
  const existing = await chrome.alarms.get(LIVE_ALARM);
  if (!settings.enabled) {
    if (existing) await chrome.alarms.clear(LIVE_ALARM);
    return;
  }
  if (!existing || existing.periodInMinutes !== settings.intervalMinutes) {
    await chrome.alarms.create(LIVE_ALARM, {
      delayInMinutes: settings.intervalMinutes,
      periodInMinutes: settings.intervalMinutes,
    });
  }
}

async function refreshLiveReflection(force = false, suppliedData?: PreprocessedTabs): Promise<{ updated: boolean; reason: string }> {
  const now = Date.now();
  const [settings, status, permission] = await Promise.all([
    ensureLiveReflectionAutostart(),
    loadLiveStatus(),
    hasTabsPermission(),
  ]);

  if (!force && !settings.enabled) return { updated: false, reason: 'disabled' };
  if (!force && settings.pausedUntil && settings.pausedUntil > now) {
    await saveLiveStatus({ ...status, state: 'paused', lastCheckedAt: now });
    return { updated: false, reason: 'paused' };
  }
  if (!permission) {
    await saveLiveStatus({
      ...status,
      state: 'error',
      lastCheckedAt: now,
      lastError: 'Tab access is no longer available.',
    });
    return { updated: false, reason: 'permission-missing' };
  }

  await saveLiveStatus({ ...status, state: 'checking', lastCheckedAt: now, lastError: undefined });
  try {
    let data = suppliedData;
    if (!data) {
      const rawTabs = await collectCurrentTabs();
      if (!rawTabs.length) throw new Error('No readable tabs were found.');
      data = preprocessTabs(rawTabs, now);
    }
    if (!data.tabs.length) throw new Error('No readable tabs were found.');
    const nextDigest = buildSnapshotDigest(data);
    const previousDigest = await loadSnapshotDigest();
    const change = compareSnapshotDigests(previousDigest, nextDigest);
    if (!force && !change.significant) {
      await saveLiveStatus({
        ...status,
        state: 'unchanged',
        lastCheckedAt: now,
        lastChangeReason: change.reason,
        lastError: undefined,
      });
      return { updated: false, reason: change.reason };
    }

    const analysis = buildLocalAnalysis(data);

    await saveSession(data, analysis);
    await saveSnapshotDigest(nextDigest);
    await saveLiveStatus({
      state: 'updated',
      lastCheckedAt: now,
      lastUpdatedAt: now,
      lastModelAt: status.lastModelAt,
      lastChangeReason: change.reason,
      lastError: undefined,
    });
    return { updated: true, reason: change.reason };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live reflection failed.';
    await saveLiveStatus({ ...status, state: 'error', lastCheckedAt: now, lastError: message });
    return { updated: false, reason: message };
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void syncLiveAlarm();
  void syncAttentionAlarm();
  queueAttention(checkpointAttention);
  if (reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_PATH) });
});

chrome.runtime.onStartup.addListener(() => {
  void syncLiveAlarm();
  void syncAttentionAlarm();
  queueAttention(async () => {
    const ledger = await loadAttentionLedger();
    await saveAttentionLedger(transitionAttention(ledger, undefined));
    await checkpointAttention();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LIVE_ALARM) void refreshLiveReflection();
  if (alarm.name === ATTENTION_ALARM) queueAttention(checkpointAttention);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  queueAttention(async () => {
    const tab = await chrome.tabs.get(tabId);
    const window = await chrome.windows.get(tab.windowId);
    if (window.focused) await recordAttention(tab);
  });
});

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (tab.active && (change.url !== undefined || change.title !== undefined)) {
    queueAttention(async () => {
      const window = await chrome.windows.get(tab.windowId);
      if (window.focused) await recordAttention(tab);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueAttention(async () => {
    const ledger = await loadAttentionLedger();
    if (ledger?.active?.tabId === tabId) await saveAttentionLedger(transitionAttention(ledger, undefined));
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  queueAttention(async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await recordAttention(undefined);
      return;
    }
    await recordAttention(await focusedActiveTab(windowId));
  });
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== 'object' || message === null || !('type' in message)) return;
  if (message.type === 'OPEN_DASHBOARD') {
    void chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_PATH) });
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'SYNC_LIVE_ALARM') {
    void syncLiveAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'RUN_LIVE_REFRESH') {
    const suppliedData = 'data' in message && typeof message.data === 'object' && message.data !== null
      ? message.data as PreprocessedTabs
      : undefined;
    void refreshLiveReflection(true, suppliedData).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_LIVE_SESSION') {
    void loadCurrentSession().then((session) => sendResponse({ session }));
    return true;
  }
});

void syncLiveAlarm();
void syncAttentionAlarm();
queueAttention(checkpointAttention);
