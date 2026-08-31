export type MissionStatus = 'active' | 'drifting' | 'stale' | 'unresolved';
export type CleanupClass = 'essential' | 'supporting' | 'redundant' | 'stale' | 'unknown';
export type MomentumKind = 'heating' | 'dominating' | 'cooling';

export interface RawTab {
  id?: number;
  title?: string;
  url?: string;
  windowId: number;
  groupId?: number;
  index?: number;
  active?: boolean;
  pinned?: boolean;
  openerTabId?: number;
  lastAccessed?: number;
}

export interface SanitizedTab {
  id: string;
  browserTabId?: number;
  title: string;
  domain: string;
  pathHint: string;
  sanitizedUrl: string;
  urlHash: string;
  windowId: number;
  groupId: number;
  active: boolean;
  pinned: boolean;
  openerTabId?: number;
  lastAccessed?: number;
  ageHours?: number;
  unsupported: boolean;
}

export interface TabCluster {
  key: string;
  label: string;
  domain: string;
  tabIds: string[];
  count: number;
  duplicateCount: number;
  newestAccess?: number;
  activeCount: number;
  pinnedCount: number;
  sampleTitles: string[];
  signals: string[];
}

export interface PreprocessedTabs {
  generatedAt: number;
  tabCount: number;
  supportedTabCount: number;
  windowCount: number;
  duplicateCount: number;
  activeTabIds: string[];
  tabs: SanitizedTab[];
  clusters: TabCluster[];
  domainFrequency: Record<string, number>;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  tabCount: number;
  confidence: number;
  status: MissionStatus;
  representativeTabs: Array<{ tabId: string; title: string; domain: string }>;
  evidenceTabIds: string[];
  signals: string[];
  nextAction?: string;
}

export interface Obsession {
  id: string;
  label: string;
  description: string;
  tabCount: number;
  share: number;
  evidenceTabIds: string[];
  domains: string[];
}

export interface MomentumSignal {
  label: string;
  kind: MomentumKind;
  detail: string;
  evidenceTabIds: string[];
}

export interface OpenLoop {
  title: string;
  description: string;
  confidence: number;
  evidenceTabIds: string[];
}

export interface CleanupItem {
  tabId: string;
  classification: CleanupClass;
  reason: string;
}

export interface Observation {
  text: string;
  confidence: number;
  evidenceTabIds: string[];
}

export interface AnalysisResult {
  version: 1;
  generatedAt: number;
  provider: 'mock' | 'local' | 'llm';
  summary: string;
  diagnosis: string;
  missions: Mission[];
  obsessions: Obsession[];
  momentum: MomentumSignal[];
  openLoops: OpenLoop[];
  cleanup: CleanupItem[];
  surprisingObservations: Observation[];
}

export interface TabSnapshot {
  id: string;
  timestamp: number;
  urlHash: string;
  sanitizedUrl: string;
  title: string;
  domain: string;
  active: boolean;
  windowId: number;
  groupId: number;
  lastAccessed?: number;
}

export interface Session {
  id: string;
  createdAt: number;
  tabCount: number;
  snapshots: TabSnapshot[];
  analysis?: AnalysisResult;
}

export type LiveRefreshInterval = 10 | 30 | 60;
export type ModelRefreshMode = 'adaptive' | 'manual';

export interface LiveReflectionSettings {
  enabled: boolean;
  intervalMinutes: LiveRefreshInterval;
  modelMode: ModelRefreshMode;
  pausedUntil?: number;
  promptDismissed: boolean;
}

export interface LiveReflectionStatus {
  state: 'idle' | 'checking' | 'updated' | 'unchanged' | 'error' | 'paused';
  lastCheckedAt?: number;
  lastUpdatedAt?: number;
  lastModelAt?: number;
  lastChangeReason?: string;
  lastError?: string;
}

export interface SnapshotDigest {
  createdAt: number;
  fingerprint: string;
  tabCount: number;
  urlHashes: string[];
  domains: Record<string, number>;
  activeDomains: string[];
}

export type FeedbackKind = 'another-thread' | 'finished' | 'not-now' | 'wrong';

export interface ReflectionFeedback {
  id: string;
  createdAt: number;
  sessionId: string;
  missionTitle: string;
  kind: FeedbackKind;
}

export interface Entity {
  id: string;
  normalizedName: string;
  type: 'company' | 'person' | 'topic' | 'product' | 'unknown';
  appearances: number;
  firstSeen: number;
  lastSeen: number;
}

export interface AttentionEvent {
  id: string;
  timestamp: number;
  kind: 'opened' | 'activated' | 'closed' | 'clustered';
  tabSnapshotId?: string;
  entityId?: string;
}

export interface AttentionEntry {
  domain: string;
  title: string;
  totalMs: number;
  activations: number;
  lastSeenAt: number;
}

export interface ActiveAttentionSample {
  tabId: number;
  windowId: number;
  domain: string;
  title: string;
  startedAt: number;
}

export interface AttentionLedger {
  dateKey: string;
  updatedAt: number;
  entries: AttentionEntry[];
  active?: ActiveAttentionSample;
}

export interface AttentionAcknowledgement {
  dateKey: string;
  domains: string[];
}
