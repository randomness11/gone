import { describe, expect, it } from 'vitest';
import { createMockTabs } from '../../mock/tabs';
import { buildLocalAnalysis } from '../localAnalysis';
import { preprocessTabs } from '../preprocessing';

describe('local analysis and cleanup classification', () => {
  const data = preprocessTabs(createMockTabs(2_000_000_000_000), 2_000_000_000_000);
  const analysis = buildLocalAnalysis(data, 'mock');

  it('turns the realistic fixture into concrete intent clusters', () => {
    expect(data.tabCount).toBe(50);
    expect(analysis.missions.length).toBeGreaterThanOrEqual(4);
    expect(analysis.missions.some((mission) => /career/i.test(mission.title))).toBe(true);
    expect(analysis.missions.some((mission) => /browser/i.test(mission.title))).toBe(true);
    expect(analysis.missions.some((mission) => /headphone/i.test(mission.title))).toBe(true);
  });

  it('classifies every tab exactly once and protects active tabs', () => {
    expect(analysis.cleanup).toHaveLength(data.tabCount);
    expect(new Set(analysis.cleanup.map((item) => item.tabId)).size).toBe(data.tabCount);
    const activeIds = new Set(data.activeTabIds);
    expect(analysis.cleanup.filter((item) => activeIds.has(item.tabId)).every((item) => item.classification === 'essential')).toBe(true);
  });
});
