import { describe, expect, it } from 'vitest';
import type { BrowserMemory } from '../../types';
import { buildLocalAnalysis } from '../localAnalysis';
import { buildBrowserPortrait, makeBrowserMemorySnapshot } from '../portrait';
import { preprocessTabs } from '../preprocessing';

describe('living browser portrait', () => {
  it('turns current tab threads into recognizable characters', () => {
    const data = preprocessTabs([
      { title: 'Chrome extension implementation', url: 'https://developer.chrome.com/docs/extensions', windowId: 1 },
      { title: 'Manifest V3 API', url: 'https://developer.chrome.com/docs/extensions/manifest', windowId: 1 },
      { title: 'Vercel careers', url: 'https://vercel.com/careers', windowId: 1 },
      { title: 'Product role at Vercel', url: 'https://jobs.ashbyhq.com/vercel/product', windowId: 1 },
    ], 1_000);
    const analysis = buildLocalAnalysis(data);
    const portrait = buildBrowserPortrait(analysis, data);

    expect(portrait.headline).toContain('versions of yourself');
    expect(portrait.characters.map((character) => character.label)).toEqual(expect.arrayContaining([
      'The builder',
      'The possible job-switcher',
    ]));
  });

  it('does not pretend a small reading cluster dominates the whole browser', () => {
    const data = preprocessTabs([
      { title: 'YouTube essay', url: 'https://youtube.com/watch/one', windowId: 1 },
      { title: 'Reddit thread', url: 'https://reddit.com/r/product', windowId: 1 },
      { title: 'Ask HN', url: 'https://news.ycombinator.com/item?id=1', windowId: 1 },
      ...Array.from({ length: 7 }, (_, index) => ({
        title: `Unrelated page ${index}`,
        url: `https://site${index}.example/page`,
        windowId: 1,
      })),
    ], 1_000);
    const portrait = buildBrowserPortrait(buildLocalAnalysis(data), data);

    expect(portrait.headline).toContain('clearest character');
    expect(portrait.detail).toContain('The rest have not formed a convincing pattern yet');
  });

  it('calls out a character only after it genuinely returns', () => {
    const data = preprocessTabs([
      { title: 'Chrome extension implementation', url: 'https://developer.chrome.com/docs/extensions', windowId: 1 },
      { title: 'Manifest V3 API', url: 'https://developer.chrome.com/docs/extensions/manifest', windowId: 1 },
    ], 3_000);
    const analysis = buildLocalAnalysis(data);
    const base = makeBrowserMemorySnapshot(data, analysis);
    const memory: BrowserMemory = {
      version: 1,
      startedAt: 1_000,
      updatedAt: 3_000,
      snapshots: [1_000, 2_000, 3_000].map((capturedAt) => ({ ...base, id: `snapshot_${capturedAt}`, capturedAt })),
    };

    expect(buildBrowserPortrait(analysis, data, memory).growthNote).toContain('returned in 3 of your last 3 reflections');
  });
});
