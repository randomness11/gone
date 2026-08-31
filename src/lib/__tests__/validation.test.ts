import { describe, expect, it } from 'vitest';
import { parseAnalysisResponse } from '../validation';

const valid = {
  version: 1,
  generatedAt: 1,
  provider: 'llm',
  summary: 'Four tabs reveal one current mission.',
  diagnosis: 'You are comparing two companies.',
  missions: [{
    id: 'm1', title: 'Comparing two companies', description: 'Two companies recur across jobs and culture pages.', tabCount: 4,
    confidence: .9, status: 'unresolved', representativeTabs: [], evidenceTabIds: ['tab_1'], signals: ['4 tabs'],
  }],
  obsessions: [], momentum: [], openLoops: [], cleanup: [], surprisingObservations: [],
};

describe('analysis response validation', () => {
  it('accepts a well-formed structured response', () => {
    expect(parseAnalysisResponse(valid).missions[0].status).toBe('unresolved');
  });

  it('rejects unsupported statuses and out-of-range confidence', () => {
    expect(() => parseAnalysisResponse({
      ...valid,
      missions: [{ ...valid.missions[0], confidence: 1.4, status: 'vibing' }],
    })).toThrow();
  });
});
