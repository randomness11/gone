import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLocalAnalysis } from '../localAnalysis';
import { preprocessTabs } from '../preprocessing';
import {
  clearTabscopeMemory,
  ensureLiveReflectionAutostart,
  loadBrowserMemory,
  loadCurrentSession,
  loadPreviousSession,
  saveLiveSettings,
  saveSession,
} from '../storage';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('reflection memory', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the immediately previous reflection for truthful change copy', async () => {
    const first = preprocessTabs([
      { title: 'First thread', url: 'https://example.com/first', windowId: 1 },
    ], 1_000);
    const second = preprocessTabs([
      { title: 'Second thread', url: 'https://example.com/second', windowId: 1 },
    ], 2_000);

    await saveSession(first, buildLocalAnalysis(first));
    await saveSession(second, buildLocalAnalysis(second));

    expect((await loadCurrentSession())?.createdAt).toBe(2_000);
    expect((await loadPreviousSession())?.createdAt).toBe(1_000);
    expect((await loadBrowserMemory())?.snapshots).toHaveLength(2);
  });

  it('replaces a refined version of the same snapshot instead of counting it twice', async () => {
    const data = preprocessTabs([
      { title: 'Building Tabscope', url: 'https://developer.chrome.com/docs/extensions', windowId: 1 },
      { title: 'Manifest V3', url: 'https://developer.chrome.com/docs/extensions/manifest', windowId: 1 },
    ], 1_000);
    const analysis = buildLocalAnalysis(data);
    await saveSession(data, analysis);
    await saveSession(data, { ...analysis, provider: 'llm', summary: 'A sharper version.' });

    expect((await loadBrowserMemory())?.snapshots).toHaveLength(1);
  });

  it('clears both current and previous reflection memory', async () => {
    const data = preprocessTabs([
      { title: 'A thread', url: 'https://example.com/thread', windowId: 1 },
    ], 1_000);
    await saveSession(data, buildLocalAnalysis(data));
    await clearTabscopeMemory();
    expect(await loadCurrentSession()).toBeUndefined();
    expect(await loadPreviousSession()).toBeUndefined();
  });

  it('enables ten-minute live reflection once without overriding a later opt-out', async () => {
    await saveLiveSettings({ enabled: false, intervalMinutes: 60, modelMode: 'manual', promptDismissed: false });
    const migrated = await ensureLiveReflectionAutostart();
    expect(migrated).toMatchObject({ enabled: true, intervalMinutes: 10, promptDismissed: true });

    await saveLiveSettings({ ...migrated, enabled: false });
    expect((await ensureLiveReflectionAutostart()).enabled).toBe(false);
  });
});
