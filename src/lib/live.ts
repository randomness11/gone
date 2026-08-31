import type { PreprocessedTabs, SnapshotDigest } from '../types';
import { stableHash } from './privacy';

export interface SnapshotChange {
  significant: boolean;
  score: number;
  reason: string;
  added: number;
  removed: number;
}

export function buildSnapshotDigest(data: PreprocessedTabs): SnapshotDigest {
  const urlHashes = [...new Set(data.tabs.filter((tab) => !tab.unsupported).map((tab) => tab.urlHash))].sort();
  const activeDomains = [...new Set(data.tabs.filter((tab) => tab.active && !tab.unsupported).map((tab) => tab.domain))].sort();
  const domains = Object.fromEntries(Object.entries(data.domainFrequency).sort(([a], [b]) => a.localeCompare(b)));
  const fingerprint = stableHash(JSON.stringify({ urlHashes, activeDomains, domains }));
  return { createdAt: data.generatedAt, fingerprint, tabCount: data.tabCount, urlHashes, domains, activeDomains };
}

export function compareSnapshotDigests(previous: SnapshotDigest | undefined, next: SnapshotDigest): SnapshotChange {
  if (!previous) {
    return { significant: true, score: 1, reason: 'first-live-snapshot', added: next.urlHashes.length, removed: 0 };
  }
  if (previous.fingerprint === next.fingerprint) {
    return { significant: false, score: 0, reason: 'no-change', added: 0, removed: 0 };
  }

  const previousUrls = new Set(previous.urlHashes);
  const nextUrls = new Set(next.urlHashes);
  const added = next.urlHashes.filter((hash) => !previousUrls.has(hash)).length;
  const removed = previous.urlHashes.filter((hash) => !nextUrls.has(hash)).length;
  const changedTabs = added + removed;
  const tabChangeShare = changedTabs / Math.max(previous.urlHashes.length, next.urlHashes.length, 1);
  const previousDomains = new Set(Object.keys(previous.domains));
  const nextDomains = new Set(Object.keys(next.domains));
  const changedDomains = [...nextDomains].filter((domain) => !previousDomains.has(domain)).length
    + [...previousDomains].filter((domain) => !nextDomains.has(domain)).length;
  const activeChanged = previous.activeDomains.join('|') !== next.activeDomains.join('|');
  const countShift = Math.abs(next.tabCount - previous.tabCount);

  const significant = changedTabs >= 3 || tabChangeShare >= 0.15 || changedDomains >= 2 || countShift >= 4;
  const score = Math.min(1, tabChangeShare + changedDomains * 0.08 + (activeChanged ? 0.05 : 0));
  const reason = significant
    ? changedDomains >= 2 ? 'attention-landscape-changed' : added > removed ? 'new-thread-emerging' : 'tabs-resolved-or-closed'
    : activeChanged ? 'active-tab-shifted' : 'minor-change';

  return { significant, score, reason, added, removed };
}

export function shouldRefreshModel(lastModelAt: number | undefined, change: SnapshotChange, now = Date.now()): boolean {
  if (!change.significant) return false;
  if (!lastModelAt) return true;
  return now - lastModelAt >= 9 * 60_000;
}
