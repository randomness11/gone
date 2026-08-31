import { analyzeTabs } from '../lib/analysis';
import { buildSnapshotDigest, compareSnapshotDigests, shouldRefreshModel } from '../lib/live';
import { buildLocalAnalysis } from '../lib/localAnalysis';
import { preprocessTabs } from '../lib/preprocessing';
import {
  ensureLiveReflectionAutostart,
  loadCurrentSession,
  loadLiveStatus,
  loadReflectionFeedback,
  loadSnapshotDigest,
  saveLiveStatus,
  saveSession,
  saveSnapshotDigest,
} from '../lib/storage';
import { collectCurrentTabs, hasTabsPermission } from '../lib/tabs';
import type { PreprocessedTabs } from '../types';

const DASHBOARD_PATH = 'dashboard.html';
const LIVE_ALARM = 'tabscope.live-reflection';
const RETIRED_ATTENTION_ALARM = 'tabscope.attention-cycle';

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
    const retryAfterFailure = Boolean(status.lastError) && settings.modelMode === 'adaptive';

    if (!force && !change.significant && !retryAfterFailure) {
      await saveLiveStatus({
        ...status,
        state: 'unchanged',
        lastCheckedAt: now,
        lastChangeReason: change.reason,
        lastError: undefined,
      });
      return { updated: false, reason: change.reason };
    }

    const useModel = force || (settings.modelMode === 'adaptive'
      && (shouldRefreshModel(status.lastModelAt, change, now) || retryAfterFailure));
    const feedback = await loadReflectionFeedback();
    let analysis;
    let modelError: string | undefined;
    if (useModel) {
      try {
        analysis = await analyzeTabs(data, false, feedback);
      } catch (error) {
        modelError = error instanceof Error ? error.message : 'The model refresh failed.';
        analysis = buildLocalAnalysis(data);
      }
    } else {
      analysis = buildLocalAnalysis(data);
    }

    await saveSession(data, analysis);
    await saveSnapshotDigest(nextDigest);
    await saveLiveStatus({
      state: modelError ? 'error' : 'updated',
      lastCheckedAt: now,
      lastUpdatedAt: now,
      lastModelAt: analysis.provider === 'llm' ? now : status.lastModelAt,
      lastChangeReason: change.reason,
      lastError: modelError,
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
  if (reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_PATH) });
});

chrome.runtime.onStartup.addListener(() => {
  void syncLiveAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LIVE_ALARM) void refreshLiveReflection();
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
