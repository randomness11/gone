import type {
  AnalysisResult,
  BrowserMemory,
  LiveReflectionSettings,
  LiveReflectionStatus,
  PreprocessedTabs,
  ReflectionFeedback,
  Session,
  SnapshotDigest,
} from '../types';
import { makeBrowserMemorySnapshot } from './portrait';
import { isChromeExtension } from './tabs';

export const CURRENT_SESSION = 'tabscope.currentSession';
export const PREVIOUS_SESSION = 'tabscope.previousSession';
export const LIVE_SETTINGS = 'tabscope.liveSettings';
export const LIVE_STATUS = 'tabscope.liveStatus';
export const SNAPSHOT_DIGEST = 'tabscope.snapshotDigest';
export const REFLECTION_FEEDBACK = 'tabscope.reflectionFeedback';
export const LIVE_AUTOSTART_MIGRATION = 'tabscope.liveAutostart.v1';
export const BROWSER_MEMORY = 'tabscope.browserMemory.v1';

export const DEFAULT_LIVE_SETTINGS: LiveReflectionSettings = {
  enabled: true,
  intervalMinutes: 10,
  modelMode: 'adaptive',
  promptDismissed: true,
};

async function readValue<T>(key: string): Promise<T | undefined> {
  if (isChromeExtension()) {
    const stored = await chrome.storage.local.get(key);
    return stored[key] as T | undefined;
  }
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  if (isChromeExtension()) await chrome.storage.local.set({ [key]: value });
  else localStorage.setItem(key, JSON.stringify(value));
}

function makeSession(preprocessed: PreprocessedTabs, analysis: AnalysisResult): Session {
  return {
    id: `session_${preprocessed.generatedAt}`,
    createdAt: preprocessed.generatedAt,
    tabCount: preprocessed.tabCount,
    snapshots: preprocessed.tabs.map((tab) => ({
      id: tab.id,
      timestamp: preprocessed.generatedAt,
      urlHash: tab.urlHash,
      sanitizedUrl: tab.sanitizedUrl,
      title: tab.title,
      domain: tab.domain,
      active: tab.active,
      windowId: tab.windowId,
      groupId: tab.groupId,
      lastAccessed: tab.lastAccessed,
    })),
    analysis,
  };
}

export async function saveSession(preprocessed: PreprocessedTabs, analysis: AnalysisResult): Promise<Session> {
  const session = makeSession(preprocessed, analysis);
  const current = await loadCurrentSession();
  if (current && current.id !== session.id) await writeValue(PREVIOUS_SESSION, current);
  await Promise.all([
    writeValue(CURRENT_SESSION, session),
    updateBrowserMemory(preprocessed, analysis),
  ]);
  return session;
}

export async function loadCurrentSession(): Promise<Session | undefined> {
  return readValue<Session>(CURRENT_SESSION);
}

export async function loadPreviousSession(): Promise<Session | undefined> {
  return readValue<Session>(PREVIOUS_SESSION);
}

export async function loadBrowserMemory(): Promise<BrowserMemory | undefined> {
  return readValue<BrowserMemory>(BROWSER_MEMORY);
}

async function updateBrowserMemory(preprocessed: PreprocessedTabs, analysis: AnalysisResult): Promise<void> {
  const now = Date.now();
  const cutoff = preprocessed.generatedAt - 30 * 24 * 60 * 60_000;
  const snapshot = makeBrowserMemorySnapshot(preprocessed, analysis);
  const current = await loadBrowserMemory();
  const existing = (current?.snapshots ?? []).filter((item) => item.capturedAt >= cutoff && item.id !== snapshot.id);
  const last = existing.at(-1);
  const signature = (item: typeof snapshot) => JSON.stringify({
    tabCount: item.tabCount,
    threads: item.threads.map((thread) => ({ key: thread.key, tabCount: thread.tabCount, domains: thread.domains, evidenceTitles: thread.evidenceTitles })),
  });
  const replacesRecentDuplicate = last
    && snapshot.capturedAt - last.capturedAt < 30 * 60_000
    && signature(last) === signature(snapshot);
  const snapshots = existing
    .filter((item) => !replacesRecentDuplicate || item.id !== last.id)
    .concat(snapshot)
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .slice(-720);
  await writeValue(BROWSER_MEMORY, {
    version: 1,
    startedAt: current?.startedAt ?? snapshot.capturedAt,
    updatedAt: now,
    snapshots,
  } satisfies BrowserMemory);
}

export async function loadLiveSettings(): Promise<LiveReflectionSettings> {
  return { ...DEFAULT_LIVE_SETTINGS, ...(await readValue<LiveReflectionSettings>(LIVE_SETTINGS)) };
}

export async function saveLiveSettings(settings: LiveReflectionSettings): Promise<void> {
  await writeValue(LIVE_SETTINGS, settings);
}

export async function ensureLiveReflectionAutostart(): Promise<LiveReflectionSettings> {
  const [settings, migrated] = await Promise.all([
    loadLiveSettings(),
    readValue<boolean>(LIVE_AUTOSTART_MIGRATION),
  ]);
  if (migrated) return settings;

  const next: LiveReflectionSettings = {
    ...settings,
    enabled: true,
    intervalMinutes: 10,
    promptDismissed: true,
    pausedUntil: undefined,
  };
  await Promise.all([
    writeValue(LIVE_SETTINGS, next),
    writeValue(LIVE_AUTOSTART_MIGRATION, true),
  ]);
  return next;
}

export async function loadLiveStatus(): Promise<LiveReflectionStatus> {
  return (await readValue<LiveReflectionStatus>(LIVE_STATUS)) ?? { state: 'idle' };
}

export async function saveLiveStatus(status: LiveReflectionStatus): Promise<void> {
  await writeValue(LIVE_STATUS, status);
}

export async function loadSnapshotDigest(): Promise<SnapshotDigest | undefined> {
  return readValue<SnapshotDigest>(SNAPSHOT_DIGEST);
}

export async function saveSnapshotDigest(digest: SnapshotDigest): Promise<void> {
  await writeValue(SNAPSHOT_DIGEST, digest);
}

export async function loadReflectionFeedback(): Promise<ReflectionFeedback[]> {
  return (await readValue<ReflectionFeedback[]>(REFLECTION_FEEDBACK)) ?? [];
}

export async function saveReflectionFeedback(feedback: ReflectionFeedback): Promise<void> {
  const current = await loadReflectionFeedback();
  await writeValue(REFLECTION_FEEDBACK, [...current, feedback].slice(-50));
}

export async function clearTabscopeMemory(): Promise<void> {
  const keys = [CURRENT_SESSION, PREVIOUS_SESSION, LIVE_STATUS, SNAPSHOT_DIGEST, REFLECTION_FEEDBACK, BROWSER_MEMORY];
  if (isChromeExtension()) await chrome.storage.local.remove(keys);
  else keys.forEach((key) => localStorage.removeItem(key));
}
