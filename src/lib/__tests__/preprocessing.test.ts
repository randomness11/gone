import { describe, expect, it } from 'vitest';
import { compactTabsForModel, findDuplicateTabIds, preprocessTabs, titleSimilarity } from '../preprocessing';

describe('tab preprocessing', () => {
  it('builds a compact domain frequency map and window count', () => {
    const result = preprocessTabs([
      { title: 'Vercel careers', url: 'https://www.vercel.com/careers?ref=x', windowId: 1, active: true },
      { title: 'Vercel pricing', url: 'https://vercel.com/pricing', windowId: 1 },
      { title: 'Chrome docs', url: 'https://developer.chrome.com/docs/extensions', windowId: 2 },
    ]);
    expect(result.tabCount).toBe(3);
    expect(result.windowCount).toBe(2);
    expect(result.domainFrequency['vercel.com']).toBe(2);
    expect(result.clusters[0].domain).toBe('vercel.com');
  });

  it('detects exact sanitized URLs and near-duplicate titles', () => {
    const result = preprocessTabs([
      { title: 'Sony XM5 review — The Verge', url: 'https://theverge.com/xm5?utm_source=a', windowId: 1 },
      { title: 'Sony XM5 review — The Verge', url: 'https://theverge.com/xm5?utm_source=b', windowId: 1 },
      { title: 'Sony XM5 review and long-term test', url: 'https://theverge.com/xm5-long-term', windowId: 1 },
    ]);
    expect(findDuplicateTabIds(result.tabs).size).toBeGreaterThanOrEqual(1);
    expect(result.duplicateCount).toBeGreaterThanOrEqual(1);
  });

  it('uses token overlap for title similarity', () => {
    expect(titleSimilarity('Chrome extension permissions API', 'Chrome extensions permissions API reference')).toBeGreaterThan(.6);
    expect(titleSimilarity('GPU inference pricing', 'Pour-over coffee guide')).toBe(0);
  });

  it('does not collapse different deep API reference paths', () => {
    const result = preprocessTabs([
      { title: 'chrome.tabs API', url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs', windowId: 1 },
      { title: 'chrome.permissions API', url: 'https://developer.chrome.com/docs/extensions/reference/api/permissions', windowId: 1 },
    ]);
    expect(result.duplicateCount).toBe(0);
  });

  it('sends coarse recency and synthetic structure to the model', () => {
    const result = preprocessTabs([
      { title: 'Private project roadmap', url: 'https://example.com/teams/ankit/private-roadmap', windowId: 42, groupId: 99, lastAccessed: Date.now() - 3_600_000 },
    ]);
    const compact = compactTabsForModel(result);
    expect(compact.tabs[0]).toMatchObject({ window: 'window_1', group: 'group_1', age: 'recent' });
    expect(compact.tabs[0]).not.toHaveProperty('pathHint');
    expect(compact.tabs[0]).not.toHaveProperty('lastAccessed');
    expect(compact.tabs[0]).not.toHaveProperty('windowId');
    expect(compact.tabs[0]).not.toHaveProperty('groupId');
  });
});
