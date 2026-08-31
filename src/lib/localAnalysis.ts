import type {
  AnalysisResult,
  CleanupClass,
  CleanupItem,
  Mission,
  MissionStatus,
  PreprocessedTabs,
  ReflectionFeedback,
  SanitizedTab,
} from '../types';
import { findDuplicateTabIds } from './preprocessing';

interface IntentRule {
  id: string;
  title: string;
  description: string;
  pattern: RegExp;
  nextAction?: string;
  unresolved?: boolean;
}

const intentRules: IntentRule[] = [
  {
    id: 'career',
    title: 'Considering your next career move',
    description: 'Role pages, company research, culture, and compensation tabs suggest there is a real choice still taking shape.',
    pattern: /\b(career|careers|job|jobs|hiring|role|roles|salary|salaries|compensation|startup offer|linkedin|ashbyhq|greenhouse|lever)\b/i,
    nextAction: 'Write down the two criteria you are actually using to compare these companies.',
    unresolved: true,
  },
  {
    id: 'gpu-infrastructure',
    title: 'Mapping the economics of AI infrastructure',
    description: 'Pricing pages, market maps, benchmarks, and GPU utilization docs point to business-model research—not just technical curiosity.',
    pattern: /\b(gpu|h100|h200|inference|vllm|coreweave|runpod|lambda|modal|baseten|together ai|semianalysis)\b/i,
    nextAction: 'Turn the open pricing tabs into one comparison table before the numbers blur together.',
  },
  {
    id: 'browser-building',
    title: 'Building something for the browser',
    description: 'The mix of API references, extension architecture, policy, and storage docs looks like active implementation work.',
    pattern: /\b(chrome extension|extensions|manifest v3|webextensions|chrome\.tabs|chrome\.permissions|crxjs|web store|browser tab)\b/i,
    nextAction: 'Close the overview articles and keep only the API references tied to the next feature.',
  },
  {
    id: 'headphones',
    title: 'Trying to choose noise-cancelling headphones',
    description: 'You are comparing the same shortlist across reviews, prices, and failure reports—a purchase decision that has not closed.',
    pattern: /\b(headphone|headphones|airpods|max|sony|xm5|bose|quietcomfort|noise cancelling|soundguys)\b/i,
    nextAction: 'Pick the one trade-off that matters most: comfort, sound, or repair risk.',
    unresolved: true,
  },
  {
    id: 'reading-media',
    title: 'Keeping a reading and watchlist nearby',
    description: 'A handful of videos, articles, and community threads look like things you may want to return to when there is room.',
    pattern: /\b(youtube|hacker news|show hn|ask hn|reddit|highlights|lofi|guide)\b/i,
  },
];

function tabText(tab: SanitizedTab): string {
  return `${tab.title} ${tab.domain} ${tab.pathHint}`;
}

function statusFor(members: SanitizedTab[], rule: IntentRule): MissionStatus {
  if (rule.unresolved) return 'unresolved';
  const averageAge = members.reduce((sum, tab) => sum + (tab.ageHours ?? 0), 0) / members.length;
  if (members.some((tab) => tab.active) || averageAge < 18) return 'active';
  if (averageAge > 96) return 'stale';
  return 'drifting';
}

function missionFromRule(rule: IntentRule, members: SanitizedTab[]): Mission {
  const status = statusFor(members, rule);
  return {
    id: rule.id,
    title: rule.title,
    description: rule.description,
    tabCount: members.length,
    confidence: Math.min(0.96, 0.62 + members.length * 0.035),
    status,
    representativeTabs: members.slice(0, 4).map((tab) => ({ tabId: tab.id, title: tab.title, domain: tab.domain })),
    evidenceTabIds: members.map((tab) => tab.id),
    signals: [
      `${members.length} related tabs`,
      `${new Set(members.map((tab) => tab.domain)).size} sources`,
      status === 'active' ? 'recently active' : status === 'unresolved' ? 'comparison still open' : 'attention fading',
    ],
    nextAction: rule.nextAction,
  };
}

function feedbackWeight(mission: Mission, feedback: ReflectionFeedback[]): number {
  const correction = [...feedback].reverse().find((item) => item.missionTitle.toLowerCase() === mission.title.toLowerCase());
  if (!correction) return 0;
  return {
    right: 100,
    partly: 30,
    anotherThread: -40,
    'another-thread': -40,
    finished: -120,
    'not-now': -80,
    wrong: -140,
  }[correction.kind] ?? 0;
}

function makeMissions(data: PreprocessedTabs, feedback: ReflectionFeedback[]): Mission[] {
  const claimed = new Set<string>();
  const missions = intentRules.flatMap((rule) => {
    const members = data.tabs.filter((tab) => !claimed.has(tab.id) && rule.pattern.test(tabText(tab)));
    if (members.length < 2) return [];
    members.forEach((tab) => claimed.add(tab.id));
    return [missionFromRule(rule, members)];
  });

  data.clusters.filter((cluster) => cluster.count >= 3 && !cluster.tabIds.some((id) => claimed.has(id))).slice(0, 2).forEach((cluster) => {
    const members = data.tabs.filter((tab) => cluster.tabIds.includes(tab.id));
    const label = cluster.label.replace(/\b\w/g, (letter) => letter.toUpperCase());
    missions.push({
      ...missionFromRule({
        id: `domain-${cluster.key}`,
        title: `Keeping ${label} in your orbit`,
        description: `${cluster.count} open pages from ${cluster.domain} make this a repeated attention pattern, even if the exact goal is unclear.`,
        pattern: /.*/,
      }, members),
      confidence: 0.64,
    });
  });

  if (missions.length === 0) {
    const members = data.tabs.filter((tab) => !tab.unsupported).slice(0, 8);
    missions.push(missionFromRule({
      id: 'general-research',
      title: 'Gathering a few things to return to',
      description: 'There is not enough repeated evidence for one clear goal yet, but several tabs look intentionally left within reach.',
      pattern: /.*/,
    }, members));
  }
  return missions.sort((a, b) => (b.tabCount + feedbackWeight(b, feedback)) - (a.tabCount + feedbackWeight(a, feedback))).slice(0, 7);
}

function cleanupClass(tab: SanitizedTab, duplicateIds: Set<string>, missionIds: Set<string>): CleanupClass {
  if (tab.active || tab.pinned) return 'essential';
  if (duplicateIds.has(tab.id)) return 'redundant';
  if (tab.unsupported) return 'unknown';
  if ((tab.ageHours ?? 0) > 96) return 'stale';
  if (missionIds.has(tab.id)) return 'supporting';
  return (tab.ageHours ?? 0) > 30 ? 'stale' : 'unknown';
}

function makeCleanup(data: PreprocessedTabs, missions: Mission[]): CleanupItem[] {
  const duplicates = findDuplicateTabIds(data.tabs);
  const missionIds = new Set(missions.flatMap((mission) => mission.evidenceTabIds));
  return data.tabs.map((tab) => {
    const classification = cleanupClass(tab, duplicates, missionIds);
    const reason: Record<CleanupClass, string> = {
      essential: tab.active ? 'Active now' : 'Pinned deliberately',
      supporting: 'Supports an inferred active mission',
      redundant: 'Duplicate or near-duplicate of another open tab',
      stale: 'Low-signal and not accessed recently',
      unknown: tab.unsupported ? 'Browser-internal page; metadata is intentionally unavailable' : 'No clear connection to a current mission',
    };
    return { tabId: tab.id, classification, reason: reason[classification] };
  });
}

export function buildLocalAnalysis(data: PreprocessedTabs, provider: 'local' | 'mock' = 'local', feedback: ReflectionFeedback[] = []): AnalysisResult {
  const missions = makeMissions(data, feedback);
  const cleanup = makeCleanup(data, missions);
  const top = missions[0];
  const second = missions[1];
  const cleanupCount = cleanup.filter((item) => item.classification === 'stale' || item.classification === 'redundant').length;
  const topMembers = data.tabs.filter((tab) => top.evidenceTabIds.includes(tab.id));
  const domainCounts = topMembers.reduce<Record<string, number>>((counts, tab) => {
    counts[tab.domain] = (counts[tab.domain] ?? 0) + 1;
    return counts;
  }, {});
  const topDomain = Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0];
  const obsessions = missions.slice(0, 3).map((mission, index) => ({
    id: `obsession-${mission.id}`,
    label: index === 0 && topDomain?.[1] >= 3 ? topDomain[0].split('.')[0] : mission.title.replace(/^(Building|Considering|Mapping|Trying to choose) /i, ''),
    description: index === 0
      ? `${mission.tabCount} tabs keep this at the center of your browser.`
      : `${mission.tabCount} tabs make this a recurring secondary thread.`,
    tabCount: mission.tabCount,
    share: mission.tabCount / Math.max(data.supportedTabCount, 1),
    evidenceTabIds: mission.evidenceTabIds,
    domains: [...new Set(data.tabs.filter((tab) => mission.evidenceTabIds.includes(tab.id)).map((tab) => tab.domain))],
  }));

  const momentum = missions.slice(0, 3).map((mission, index) => {
    const members = data.tabs.filter((tab) => mission.evidenceTabIds.includes(tab.id));
    const averageAge = members.reduce((sum, tab) => sum + (tab.ageHours ?? 24), 0) / members.length;
    const kind = index === 0 ? 'dominating' as const : averageAge < 20 ? 'heating' as const : 'cooling' as const;
    return {
      label: mission.title,
      kind,
      detail: kind === 'dominating' ? `${mission.tabCount} open tabs make this your largest attention cluster.` : kind === 'heating' ? 'Several of these tabs were accessed recently.' : 'This cluster is open, but its recent activity is fading.',
      evidenceTabIds: mission.evidenceTabIds,
    };
  });

  const unresolved = missions.filter((mission) => mission.status === 'unresolved');
  const openLoops = unresolved.map((mission) => ({
    title: mission.id === 'headphones' ? 'Sony, Bose, or stop comparing?' : `What would make “${mission.title}” resolved?`,
    description: mission.id === 'career'
      ? 'The tabs cover roles, culture, compensation, and startup risk, but no single decision criterion dominates.'
      : 'Repeated comparison pages suggest the shortlist is clear but the deciding constraint is not.',
    confidence: mission.confidence,
    evidenceTabIds: mission.evidenceTabIds,
  }));

  const diagnosis = second
    ? `You seem to be holding two meaningful threads at once: ${top.title.toLowerCase()}, with ${second.title.toLowerCase()} quietly alongside it.`
    : `A lot of what is open seems to lead back to ${top.title.toLowerCase()}.`;

  return {
    version: 1,
    generatedAt: Date.now(),
    provider,
    summary: `${missions.length} meaningful threads show up across what is open, with ${cleanupCount} tabs that may be ready to let go.`,
    diagnosis,
    missions,
    obsessions,
    momentum,
    openLoops,
    cleanup,
    surprisingObservations: [{
      text: second
        ? `${Math.round(((top.tabCount + second.tabCount) / Math.max(data.tabCount, 1)) * 100)}% of your tabs support just two missions: “${top.title}” and “${second.title}.”`
        : `${Math.round((top.tabCount / Math.max(data.tabCount, 1)) * 100)}% of your open tabs point to one dominant mission.`,
      confidence: Math.min(top.confidence, second?.confidence ?? top.confidence),
      evidenceTabIds: [...top.evidenceTabIds, ...(second?.evidenceTabIds ?? [])],
    }],
  };
}
