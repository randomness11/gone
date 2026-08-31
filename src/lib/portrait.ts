import type {
  AnalysisResult,
  BrowserMemory,
  BrowserMemorySnapshot,
  Mission,
  PreprocessedTabs,
} from '../types';

export interface PortraitCharacter {
  key: string;
  label: string;
  sourceTitle: string;
  tabCount: number;
  domains: string[];
  evidenceTitles: string[];
  evidenceTabIds: string[];
}

export interface BrowserPortrait {
  stage: 'first-look' | 'noticing' | 'familiar' | 'growing';
  eyebrow: string;
  headline: string;
  detail: string;
  growthLabel: string;
  growthNote: string;
  characters: PortraitCharacter[];
  snapshotCount: number;
}

const CHARACTER_RULES: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'possible-job-switcher', label: 'The possible job-switcher', pattern: /\b(career|job|role|hiring|company culture|compensation|salary|next move)\b/i },
  { key: 'careful-chooser', label: 'The careful chooser', pattern: /\b(choos|compar|shortlist|purchase|headphone|review|price)\b/i },
  { key: 'builder', label: 'The builder', pattern: /\b(build|building|implementation|extension|developer|code|api|manifest|shipping|product)\b/i },
  { key: 'systems-thinker', label: 'The systems thinker', pattern: /\b(infrastructure|economics|gpu|inference|market map|benchmark|pricing)\b/i },
  { key: 'collector', label: 'The collector', pattern: /\b(reading|watchlist|article|video|youtube|reddit|hacker news|things to return)\b/i },
  { key: 'researcher', label: 'The researcher', pattern: /\b(mapping|research|explor|understanding|investigat)\b/i },
];

function domainName(domain: string): string {
  const part = domain.split('.')[0];
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : domain;
}

function missionText(mission: Mission): string {
  return `${mission.title} ${mission.description} ${mission.representativeTabs.map((tab) => `${tab.title} ${tab.domain}`).join(' ')}`;
}

export function describeMissionCharacter(mission: Mission): { key: string; label: string } {
  const text = missionText(mission);
  const match = CHARACTER_RULES.find((rule) => rule.pattern.test(text));
  if (match) return { key: match.key, label: match.label };

  const domain = mission.representativeTabs.find((tab) => tab.domain && tab.domain !== 'unknown')?.domain;
  if (domain) {
    const name = domainName(domain);
    return { key: `regular-${domain}`, label: `The ${name} regular` };
  }
  const normalized = mission.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return { key: `thread-${normalized || mission.id}`, label: 'The curious one' };
}

function uniqueCharacterMissions(missions: Mission[]) {
  const seen = new Set<string>();
  return missions.flatMap((mission) => {
    const character = describeMissionCharacter(mission);
    if (seen.has(character.key)) return [];
    seen.add(character.key);
    return [{ mission, character }];
  });
}

export function makeBrowserMemorySnapshot(
  data: PreprocessedTabs,
  analysis: AnalysisResult,
): BrowserMemorySnapshot {
  return {
    id: `snapshot_${data.generatedAt}`,
    capturedAt: data.generatedAt,
    tabCount: data.tabCount,
    threads: uniqueCharacterMissions(analysis.missions).slice(0, 7).map(({ mission, character }) => {
      return {
        key: character.key,
        label: character.label,
        tabCount: mission.tabCount,
        domains: [...new Set(mission.representativeTabs.map((tab) => tab.domain).filter((domain) => domain !== 'unknown'))].slice(0, 4),
        evidenceTitles: mission.representativeTabs.map((tab) => tab.title).slice(0, 4),
      };
    }),
  };
}

function countWord(count: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five'][count] ?? String(count);
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function buildGrowthNote(characters: PortraitCharacter[], memory: BrowserMemory | undefined): { label: string; note: string } {
  const history = memory?.snapshots.slice(-48) ?? [];
  if (history.length <= 1) {
    return {
      label: 'The first brushstroke',
      note: 'Tabscope is meeting this version of you for the first time. The portrait will get more specific when patterns return.',
    };
  }

  const first = characters[0];
  const second = characters[1];
  if (first && second) {
    const together = history.filter((snapshot) => {
      const keys = new Set(snapshot.threads.map((thread) => thread.key));
      return keys.has(first.key) && keys.has(second.key);
    }).length;
    if (together >= 3) {
      return {
        label: 'A pattern that keeps returning',
        note: `${first.label} and ${lowerFirst(second.label)} have appeared together in ${together} recent reflections.`,
      };
    }
  }

  if (first) {
    const appearances = history.filter((snapshot) => snapshot.threads.some((thread) => thread.key === first.key)).length;
    if (appearances >= 3) {
      return {
        label: 'Becoming familiar',
        note: `${first.label} has returned in ${appearances} of your last ${history.length} reflections.`,
      };
    }
  }

  return {
    label: 'The portrait is taking shape',
    note: `Tabscope has seen ${history.length} different shapes of your browser and is learning which ones actually return.`,
  };
}

export function buildBrowserPortrait(
  analysis: AnalysisResult,
  data: PreprocessedTabs,
  memory?: BrowserMemory,
): BrowserPortrait {
  const characters = uniqueCharacterMissions(analysis.missions).slice(0, 3).map<PortraitCharacter>(({ mission, character }) => {
    return {
      ...character,
      sourceTitle: mission.title,
      tabCount: mission.tabCount,
      domains: [...new Set(mission.representativeTabs.map((tab) => tab.domain).filter((domain) => domain !== 'unknown'))].slice(0, 3),
      evidenceTitles: mission.representativeTabs.map((tab) => tab.title).slice(0, 4),
      evidenceTabIds: mission.evidenceTabIds,
    };
  });

  const first = characters[0];
  const second = characters[1];
  const share = first ? first.tabCount / Math.max(data.supportedTabCount, 1) : 0;
  let headline: string;
  let detail: string;

  if (characters.length >= 2) {
    headline = `You currently have ${countWord(characters.length)} versions of yourself open.`;
    detail = `${first.label} is loudest with ${first.tabCount} tabs. ${second.label} is staying close with ${second.tabCount}.`;
  } else if (first && share >= 0.4) {
    headline = `${first.label} has taken over your browser.`;
    detail = `${first.tabCount} of ${data.supportedTabCount} readable tabs are pointing in the same direction.`;
  } else if (first) {
    headline = `${first.label} is the clearest character in your browser right now.`;
    detail = `It connects ${first.tabCount} of ${data.supportedTabCount} readable tabs. The rest have not formed a convincing pattern yet.`;
  } else {
    headline = 'Your browser has not introduced itself yet.';
    detail = 'A few more recognizable tabs will give Tabscope something honest to notice.';
  }

  const snapshotCount = memory?.snapshots.length ?? 0;
  const stage: BrowserPortrait['stage'] = snapshotCount <= 1
    ? 'first-look'
    : snapshotCount <= 5
      ? 'noticing'
      : snapshotCount <= 20
        ? 'familiar'
        : 'growing';
  const growth = buildGrowthNote(characters, memory);

  return {
    stage,
    eyebrow: stage === 'first-look' ? 'Your browser, right now' : stage === 'noticing' ? 'Something is starting to repeat' : 'A portrait taking shape',
    headline,
    detail,
    growthLabel: growth.label,
    growthNote: growth.note,
    characters,
    snapshotCount,
  };
}
