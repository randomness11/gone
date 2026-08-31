import type { PreprocessedTabs, RawTab, SanitizedTab, TabCluster } from '../types';
import { sanitizeTabForAI } from './privacy';

const SIGNAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(job|jobs|career|careers|hiring|role|interview|linkedin)\b/i, 'career'],
  [/\b(price|pricing|compare|versus|vs\.?|review|best|buy|shop)\b/i, 'comparison'],
  [/\b(doc|docs|documentation|api|developer|github|stackoverflow)\b/i, 'building'],
  [/\b(search|results?|query)\b/i, 'search'],
  [/\b(youtube|reddit|news|hacker news)\b/i, 'feed'],
];

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:new tab|official|homepage|home)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b([a-z]{4,})s\b/g, '$1')
    .trim();
}

export function titleSimilarity(a: string, b: string): number {
  const first = new Set(normalizeTitle(a).split(' ').filter((word) => word.length > 2));
  const second = new Set(normalizeTitle(b).split(' ').filter((word) => word.length > 2));
  if (!first.size || !second.size) return 0;
  const intersection = [...first].filter((word) => second.has(word)).length;
  const union = new Set([...first, ...second]).size;
  return intersection / union;
}

export function findDuplicateTabIds(tabs: SanitizedTab[]): Set<string> {
  const duplicates = new Set<string>();
  const seenUrls = new Map<string, string>();

  tabs.forEach((tab, index) => {
    const existing = seenUrls.get(tab.urlHash);
    if (existing && tab.sanitizedUrl) duplicates.add(tab.id);
    else seenUrls.set(tab.urlHash, tab.id);

    const priorSameDomain = tabs.slice(Math.max(0, index - 30), index).find(
      (candidate) => candidate.domain === tab.domain && titleSimilarity(candidate.title, tab.title) >= 0.82,
    );
    if (priorSameDomain) duplicates.add(tab.id);
  });
  return duplicates;
}

function signalsForTab(tab: SanitizedTab): string[] {
  const haystack = `${tab.title} ${tab.domain} ${tab.pathHint}`;
  return SIGNAL_PATTERNS.filter(([pattern]) => pattern.test(haystack)).map(([, signal]) => signal);
}

function clusterTabs(tabs: SanitizedTab[], duplicates: Set<string>): TabCluster[] {
  const byDomain = new Map<string, SanitizedTab[]>();
  tabs.filter((tab) => !tab.unsupported).forEach((tab) => {
    byDomain.set(tab.domain, [...(byDomain.get(tab.domain) ?? []), tab]);
  });

  return [...byDomain.entries()]
    .map(([domain, members]) => {
      const allSignals = members.flatMap(signalsForTab);
      const signals = [...new Set(allSignals)];
      return {
        key: domain,
        label: domain.split('.')[0].replace(/[-_]/g, ' '),
        domain,
        tabIds: members.map((tab) => tab.id),
        count: members.length,
        duplicateCount: members.filter((tab) => duplicates.has(tab.id)).length,
        newestAccess: Math.max(...members.map((tab) => tab.lastAccessed ?? 0)) || undefined,
        activeCount: members.filter((tab) => tab.active).length,
        pinnedCount: members.filter((tab) => tab.pinned).length,
        sampleTitles: members.slice(0, 4).map((tab) => tab.title),
        signals,
      } satisfies TabCluster;
    })
    .sort((a, b) => b.count - a.count || (b.newestAccess ?? 0) - (a.newestAccess ?? 0));
}

export function preprocessTabs(rawTabs: RawTab[], now = Date.now()): PreprocessedTabs {
  const tabs = rawTabs.map((tab, index) => sanitizeTabForAI(tab, index, now));
  const duplicates = findDuplicateTabIds(tabs);
  const domainFrequency = tabs.reduce<Record<string, number>>((counts, tab) => {
    if (!tab.unsupported) counts[tab.domain] = (counts[tab.domain] ?? 0) + 1;
    return counts;
  }, {});

  return {
    generatedAt: now,
    tabCount: tabs.length,
    supportedTabCount: tabs.filter((tab) => !tab.unsupported).length,
    windowCount: new Set(tabs.map((tab) => tab.windowId)).size,
    duplicateCount: duplicates.size,
    activeTabIds: tabs.filter((tab) => tab.active).map((tab) => tab.id),
    tabs,
    clusters: clusterTabs(tabs, duplicates),
    domainFrequency,
  };
}

export function compactTabsForModel(data: PreprocessedTabs) {
  const windowLabels = new Map<number, string>();
  const groupLabels = new Map<number, string>();
  const syntheticLabel = (map: Map<number, string>, value: number, prefix: string) => {
    const existing = map.get(value);
    if (existing) return existing;
    const label = `${prefix}_${map.size + 1}`;
    map.set(value, label);
    return label;
  };
  const ageBucket = (hours?: number) => {
    if (hours === undefined) return 'unknown';
    if (hours <= 6) return 'recent';
    if (hours <= 24) return 'today';
    if (hours <= 168) return 'this-week';
    return 'older';
  };
  return {
    stats: {
      tabCount: data.tabCount,
      windowCount: data.windowCount,
      duplicates: data.duplicateCount,
    },
    domainClusters: data.clusters.map((cluster) => ({
      domain: cluster.domain,
      count: cluster.count,
      tabIds: cluster.tabIds,
      sampleTitles: cluster.sampleTitles.map((title) => title.slice(0, 120)),
      signals: cluster.signals,
      activeCount: cluster.activeCount,
      pinnedCount: cluster.pinnedCount,
    })),
    tabs: data.tabs.map(({ id, title, domain, active, pinned, windowId, groupId, ageHours }) => ({
      id,
      title: title.slice(0, 120),
      domain,
      active,
      pinned,
      window: syntheticLabel(windowLabels, windowId, 'window'),
      group: groupId >= 0 ? syntheticLabel(groupLabels, groupId, 'group') : undefined,
      age: ageBucket(ageHours),
    })),
  };
}
