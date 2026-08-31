import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../types';
import { validateAnalysisAgainstSnapshot } from '../llm';
import { preprocessTabs } from '../preprocessing';

const data = preprocessTabs([
  { title: 'Chrome tabs API', url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs', windowId: 1 },
  { title: 'Chrome permissions API', url: 'https://developer.chrome.com/docs/extensions/reference/api/permissions', windowId: 1 },
], 2_000_000_000_000);

function validAnalysis(): AnalysisResult {
  const ids = data.tabs.map((tab) => tab.id);
  return {
    version: 1,
    generatedAt: 1,
    provider: 'llm',
    summary: 'Two API references support one implementation mission.',
    diagnosis: 'You are implementing an extension permission flow.',
    missions: [{
      id: 'm1', title: 'Implementing extension permissions', description: 'Two API references support active implementation.',
      tabCount: 2, confidence: .9, status: 'active', representativeTabs: [{ tabId: ids[0], title: 'invented title', domain: 'invented.test' }],
      evidenceTabIds: ids, signals: ['2 API references'],
    }],
    obsessions: [{ id: 'o1', label: 'Chrome APIs', description: 'Both tabs are API docs.', tabCount: 2, share: 1, evidenceTabIds: ids, domains: ['developer.chrome.com'] }],
    momentum: [{ label: 'Extension implementation', kind: 'dominating', detail: 'Both tabs support it.', evidenceTabIds: ids }],
    openLoops: [{ title: 'Permission flow', description: 'The implementation decision is open.', confidence: .8, evidenceTabIds: ids }],
    cleanup: ids.map((tabId) => ({ tabId, classification: 'supporting', reason: 'Supports the mission' })),
    surprisingObservations: [{ text: 'All visible attention supports one implementation task.', confidence: .9, evidenceTabIds: ids }],
  };
}

describe('LLM evidence integrity', () => {
  it('canonicalizes displayed evidence from the sanitized snapshot', () => {
    const result = validateAnalysisAgainstSnapshot(validAnalysis(), data);
    expect(result.missions[0].representativeTabs[0].title).toBe(data.tabs[0].title);
    expect(result.missions[0].representativeTabs[0].domain).toBe(data.tabs[0].domain);
  });

  it('rejects hallucinated IDs and incomplete cleanup classifications', () => {
    const hallucinated = validAnalysis();
    hallucinated.missions[0].evidenceTabIds = [data.tabs[0].id, 'tab_not_real'];
    expect(() => validateAnalysisAgainstSnapshot(hallucinated, data)).toThrow(/unknown tab IDs/);

    const incomplete = validAnalysis();
    incomplete.cleanup = incomplete.cleanup.slice(0, 1);
    expect(() => validateAnalysisAgainstSnapshot(incomplete, data)).toThrow(/every supplied tab exactly once/);
  });
});
