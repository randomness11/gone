import { describe, expect, it } from 'vitest';
import type { SnapshotDigest } from '../../types';
import { compareSnapshotDigests, shouldRefreshModel } from '../live';

function digest(overrides: Partial<SnapshotDigest> = {}): SnapshotDigest {
  return {
    createdAt: 1,
    fingerprint: 'base',
    tabCount: 4,
    urlHashes: ['a', 'b', 'c', 'd'],
    domains: { 'a.com': 2, 'b.com': 2 },
    activeDomains: ['a.com'],
    ...overrides,
  };
}

describe('live reflection change detection', () => {
  it('ignores an identical snapshot', () => {
    expect(compareSnapshotDigests(digest(), digest())).toMatchObject({ significant: false, reason: 'no-change' });
  });

  it('recognizes a material tab shift', () => {
    const next = digest({ fingerprint: 'next', tabCount: 6, urlHashes: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(compareSnapshotDigests(digest(), next)).toMatchObject({ significant: true, added: 2, removed: 0 });
  });

  it('does not spend a model call on a minor active-tab change', () => {
    const next = digest({ fingerprint: 'next', activeDomains: ['b.com'] });
    const change = compareSnapshotDigests(digest(), next);
    expect(change.significant).toBe(false);
    expect(shouldRefreshModel(Date.now() - 60 * 60_000, change)).toBe(false);
  });

  it('rate limits adaptive model refreshes', () => {
    const change = { significant: true, score: 1, reason: 'changed', added: 4, removed: 0 };
    expect(shouldRefreshModel(Date.now() - 5 * 60_000, change)).toBe(false);
    expect(shouldRefreshModel(Date.now() - 10 * 60_000, change)).toBe(true);
  });
});
