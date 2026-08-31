import { ArrowRight, Check, Clock3, Pause, RefreshCcw, Settings2, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { preprocessTabs } from '../../lib/preprocessing';
import {
  clearTabscopeMemory,
  ATTENTION_LEDGER,
  DEFAULT_LIVE_SETTINGS,
  LIVE_SETTINGS,
  LIVE_STATUS,
  loadLiveSettings,
  loadLiveStatus,
  loadAttentionLedger,
  saveLiveSettings,
  saveReflectionFeedback,
} from '../../lib/storage';
import { activateBrowserTab, closeTabsByBrowserId, collectCurrentTabs, isChromeExtension } from '../../lib/tabs';
import type {
  AnalysisResult,
  AttentionLedger,
  CleanupClass,
  FeedbackKind,
  LiveReflectionSettings,
  LiveReflectionStatus,
  Mission,
  PreprocessedTabs,
  Session,
} from '../../types';

const CLASS_COPY: Record<CleanupClass, string> = {
  essential: 'Worth keeping',
  supporting: 'Part of the thread',
  redundant: 'Looks repeated',
  stale: 'May be finished',
  unknown: 'Not sure',
};

function domainName(domain: string): string {
  const part = domain.split('.')[0];
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : domain;
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function focusPhrase(title?: string): string {
  if (!title) return 'something that matters to you';
  const withoutFraming = title
    .replace(/^(mapping|considering|comparing|researching|exploring|understanding|planning)\s+/i, '')
    .replace(/^trying to choose\s+/i, 'choosing ');
  return lowerFirst(withoutFraming);
}

function freshness(timestamp?: number): string {
  if (!timestamp) return 'Not checked yet';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes === 1) return 'Updated 1 minute ago';
  if (minutes < 60) return `Updated ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return `Updated ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}

function missionDomains(mission: Mission): string[] {
  return [...new Set(mission.representativeTabs.map((tab) => tab.domain))].slice(0, 3);
}

function formatAttention(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function demoAttention(data: PreprocessedTabs): AttentionLedger {
  const now = Date.now();
  const domains = data.clusters.slice(0, 3);
  return {
    dateKey: new Date(now).toISOString().slice(0, 10),
    updatedAt: now,
    entries: domains.map((cluster, index) => ({
      domain: cluster.domain,
      title: cluster.sampleTitles[0] ?? cluster.domain,
      totalMs: [38, 24, 11][index] * 60_000,
      activations: Math.max(1, cluster.count),
      lastSeenAt: now - index * 12 * 60_000,
    })),
  };
}

function LiveSettingsModal({
  open,
  onClose,
  settings,
  status,
  onChange,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  settings: LiveReflectionSettings;
  status: LiveReflectionStatus;
  onChange: (patch: Partial<LiveReflectionSettings>) => Promise<void>;
  onRefresh: () => void;
}) {
  const [clearReady, setClearReady] = useState(false);

  const clearMemory = async () => {
    if (!clearReady) {
      setClearReady(true);
      return;
    }
    await clearTabscopeMemory();
    window.location.reload();
  };

  return (
    <Modal open={open} onClose={onClose} title="Live reflection">
      <div className="live-settings">
        <div className="settings-row">
          <div><strong>Keep Tabscope current</strong><p>Check locally for meaningful changes while Chrome is open.</p></div>
          <button className={`chrome-switch ${settings.enabled ? 'on' : ''}`} role="switch" aria-checked={settings.enabled} onClick={() => void onChange({ enabled: !settings.enabled, promptDismissed: true })}><i /></button>
        </div>

        <div className="settings-section">
          <label>Check interval</label>
          <div className="settings-segmented">
            {([10, 30, 60] as const).map((minutes) => <button key={minutes} className={settings.intervalMinutes === minutes ? 'selected' : ''} onClick={() => void onChange({ intervalMinutes: minutes })}>{minutes === 60 ? '1 hour' : `${minutes} min`}</button>)}
          </div>
        </div>

        <div className="settings-section">
          <label htmlFor="model-refresh-mode">Model refresh</label>
          <select id="model-refresh-mode" value={settings.modelMode} onChange={(event) => void onChange({ modelMode: event.target.value as LiveReflectionSettings['modelMode'] })}>
            <option value="adaptive">Adaptive — only after meaningful change</option>
            <option value="manual">Manual — only when I ask</option>
          </select>
          <p>Local checks do not contact the model. Adaptive mode only does so when the shape of your tabs materially changes.</p>
        </div>

        <div className="settings-status"><Clock3 size={16} /><div><strong>{status.state === 'checking' ? 'Checking now…' : freshness(status.lastUpdatedAt)}</strong><p>{status.lastError ?? (status.lastChangeReason ? status.lastChangeReason.replaceAll('-', ' ') : 'Waiting for the next meaningful change')}</p></div></div>

        <div className="settings-actions">
          <button className="chrome-secondary-button" onClick={() => void onChange({ pausedUntil: settings.pausedUntil && settings.pausedUntil > Date.now() ? undefined : Date.now() + 24 * 60 * 60_000 })}><Pause size={15} /> {settings.pausedUntil && settings.pausedUntil > Date.now() ? 'Resume' : 'Pause for today'}</button>
          <button className="chrome-action-button" onClick={onRefresh}><RefreshCcw size={15} /> Refresh now</button>
        </div>

        <button className={`clear-memory-button ${clearReady ? 'confirm' : ''}`} onClick={() => void clearMemory()}>{clearReady ? 'Confirm: clear reflections and corrections' : 'Clear Tabscope memory'}</button>
      </div>
    </Modal>
  );
}

function CorrectionModal({
  open,
  onClose,
  mission,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  mission?: Mission;
  onSelect: (kind: FeedbackKind) => void;
}) {
  const options: Array<{ kind: FeedbackKind; title: string; detail: string }> = [
    { kind: 'another-thread', title: 'Show me another thread', detail: 'This may be real, but it is not the main thing.' },
    { kind: 'finished', title: 'I’m finished with this', detail: 'Do not keep leading with this unless it clearly returns.' },
    { kind: 'not-now', title: 'This matters, but not today', detail: 'Treat it as waiting rather than active.' },
    { kind: 'wrong', title: 'This is simply wrong', detail: 'Lower confidence in this interpretation.' },
  ];
  return (
    <Modal open={open} onClose={onClose} title="Help Tabscope understand">
      <div className="correction-panel">
        <p>Tabscope thought <strong>{mission?.title ?? 'this thread'}</strong> was central. What should it know?</p>
        <div className="correction-options">
          {options.map((option) => <button key={option.kind} onClick={() => onSelect(option.kind)}><span>{option.title}</span><small>{option.detail}</small><ArrowRight size={16} /></button>)}
        </div>
        <p className="correction-foot">Your correction stays in Tabscope’s local storage and guides later reflections.</p>
      </div>
    </Modal>
  );
}

function ReflectionDetails({
  open,
  onClose,
  analysis,
}: {
  open: boolean;
  onClose: () => void;
  analysis: AnalysisResult;
}) {
  return (
    <Modal open={open} onClose={onClose} title="What shaped this reflection">
      <div className="reflection-details">
        <p className="reflection-details-lede">A few patterns showed up more than once.</p>
        {analysis.missions.slice(0, 3).map((mission) => (
          <div className="reflection-signal" key={mission.id}>
            <div>
              <strong>{mission.title}</strong>
              <p>{mission.description}</p>
            </div>
            <div className="reflection-domains">
              {[...new Set(mission.representativeTabs.map((tab) => domainName(tab.domain)))].slice(0, 3).map((domain) => <span key={domain}>{domain}</span>)}
            </div>
          </div>
        ))}
        <p className="reflection-caveat">These are patterns in what is open—not conclusions about who you are. Keep what resonates and ignore what doesn’t.</p>
      </div>
    </Modal>
  );
}

function CleanupReview({
  open,
  onClose,
  analysis,
  data,
}: {
  open: boolean;
  onClose: () => void;
  analysis: AnalysisResult;
  data: PreprocessedTabs;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const cleanupById = new Map(analysis.cleanup.map((item) => [item.tabId, item]));
  const reviewTabs = data.tabs.filter((tab) => {
    const type = cleanupById.get(tab.id)?.classification;
    return type === 'stale' || type === 'redundant' || type === 'unknown';
  });

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectSuggested = () => setSelected(new Set(reviewTabs.filter((tab) => {
    const type = cleanupById.get(tab.id)?.classification;
    return !closed.has(tab.id) && (type === 'stale' || type === 'redundant');
  }).map((tab) => tab.id)));

  const closeSelected = async () => {
    const tabs = reviewTabs.filter((tab) => selected.has(tab.id) && tab.browserTabId !== undefined);
    if (!isChromeExtension()) {
      setMessage('The preview never closes real tabs. This only works in the installed extension.');
      return;
    }
    if (tabs.length !== selected.size) {
      setMessage('This reflection is from an earlier moment. Reflect again before closing anything.');
      return;
    }
    setWorking(true);
    try {
      await closeTabsByBrowserId(tabs.map((tab) => tab.browserTabId!));
      setClosed((current) => new Set([...current, ...tabs.map((tab) => tab.id)]));
      setSelected(new Set());
      setMessage(`${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'} closed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Those tabs could not be closed.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Make a little room" wide>
      <div className="cleanup-toolbar">
        <p>These look less connected to what you’re doing right now. Nothing is chosen for you.</p>
        <button className="small-button" onClick={selectSuggested}>Choose likely extras</button>
      </div>
      {message && <div className="cleanup-message">{message}</div>}
      <div className="cleanup-list">
        {reviewTabs.map((tab) => {
          const item = cleanupById.get(tab.id);
          const isClosed = closed.has(tab.id);
          return (
            <button key={tab.id} className={`cleanup-row ${selected.has(tab.id) ? 'selected' : ''} ${isClosed ? 'closed' : ''}`} onClick={() => !isClosed && toggle(tab.id)} disabled={isClosed}>
              <span className="cleanup-check">{isClosed ? <X size={14} /> : selected.has(tab.id) ? <Check size={14} /> : null}</span>
              <span className="domain-avatar">{domainName(tab.domain).slice(0, 1)}</span>
              <span className="cleanup-title"><b>{tab.title}</b><small>{tab.domain}{tab.pathHint}</small></span>
              <span className={`class-pill class-${item?.classification ?? 'unknown'}`}>{isClosed ? 'Closed' : CLASS_COPY[item?.classification ?? 'unknown']}</span>
              <span className="cleanup-reason">You decide whether this still belongs.</span>
            </button>
          );
        })}
      </div>
      <div className="cleanup-footer">
        <span>{selected.size ? `${selected.size} chosen` : 'Choose only what feels safe to close'}</span>
        <button className="danger-button" disabled={!selected.size || working} onClick={() => void closeSelected()}><Trash2 size={15} /> {working ? 'Closing…' : `Close ${selected.size || ''} ${selected.size === 1 ? 'tab' : 'tabs'}`}</button>
      </div>
    </Modal>
  );
}

export function AnalysisView({ analysis, data, notice, revealStep, onRefresh }: {
  analysis: AnalysisResult;
  data: PreprocessedTabs;
  previousSession?: Session;
  notice?: string;
  revealStep: number;
  onRefresh: () => void;
}) {
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [missionIndex, setMissionIndex] = useState(0);
  const [correctionMessage, setCorrectionMessage] = useState<string>();
  const [resolved, setResolved] = useState(false);
  const [attention, setAttention] = useState<AttentionLedger>();
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settings, setSettings] = useState<LiveReflectionSettings>(DEFAULT_LIVE_SETTINGS);
  const [status, setStatus] = useState<LiveReflectionStatus>({ state: 'idle' });
  const primaryMission = analysis.missions[missionIndex] ?? analysis.missions[0];
  const looseCount = analysis.cleanup.filter((item) => item.classification === 'redundant' || item.classification === 'stale').length;
  const domains = missionDomains(primaryMission);
  const openQuestion = analysis.openLoops[0];
  const visibleAttention = (attention?.entries ?? []).filter((entry) => entry.totalMs >= 30_000).sort((a, b) => b.totalMs - a.totalMs).slice(0, 3);
  const totalAttention = visibleAttention.reduce((sum, entry) => sum + entry.totalMs, 0);
  const topAttention = visibleAttention[0];
  const topShare = topAttention ? topAttention.totalMs / Math.max(totalAttention, 1) : 0;
  const deservesInterruption = Boolean(topAttention && topAttention.totalMs >= 10 * 60_000 && topShare >= .4);
  const attentionName = topAttention ? domainName(topAttention.domain) : undefined;
  const localHeadline = deservesInterruption
    ? topAttention!.activations >= 3 ? `${attentionName} keeps pulling you back.` : `${attentionName} became the session.`
    : `You keep coming back to ${focusPhrase(primaryMission.title)}.`;
  const localExplanation = topAttention
    ? `${attentionName} has held ${formatAttention(topAttention.totalMs)} of observed active browser time today. Meanwhile, ${lowerFirst(primaryMission.title)} is still open underneath it.`
    : `${primaryMission.tabCount} open ${primaryMission.tabCount === 1 ? 'tab points' : 'tabs point'} to this thread. Tabscope is starting to notice where your active browser time actually goes.`;
  const useModelConscience = analysis.provider === 'llm'
    && Boolean(attentionName)
    && analysis.diagnosis.toLowerCase().includes(attentionName!.toLowerCase());
  const headline = useModelConscience ? analysis.diagnosis : localHeadline;
  const explanation = useModelConscience ? analysis.summary : localExplanation;

  useEffect(() => {
    void Promise.all([loadLiveSettings(), loadLiveStatus(), loadAttentionLedger()]).then(([nextSettings, nextStatus, nextAttention]) => {
      setSettings(nextSettings);
      setStatus(nextStatus);
      setAttention(nextAttention ?? (!isChromeExtension() ? demoAttention(data) : undefined));
      setSettingsLoaded(true);
    });
    if (!isChromeExtension()) return;
    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[LIVE_SETTINGS]?.newValue) setSettings({ ...DEFAULT_LIVE_SETTINGS, ...changes[LIVE_SETTINGS].newValue as LiveReflectionSettings });
      if (changes[LIVE_STATUS]?.newValue) setStatus(changes[LIVE_STATUS].newValue as LiveReflectionStatus);
      if (changes[ATTENTION_LEDGER]?.newValue) setAttention(changes[ATTENTION_LEDGER].newValue as AttentionLedger);
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, [data]);

  useEffect(() => { setMissionIndex(0); setResolved(false); }, [analysis.generatedAt]);

  const updateSettings = async (patch: Partial<LiveReflectionSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveLiveSettings(next);
    if (isChromeExtension()) void chrome.runtime.sendMessage({ type: 'SYNC_LIVE_ALARM' });
  };

  const recordCorrection = async (kind: FeedbackKind, mission = primaryMission) => {
    await saveReflectionFeedback({
      id: `feedback_${Date.now()}`,
      createdAt: Date.now(),
      sessionId: `session_${analysis.generatedAt}`,
      missionTitle: mission.title,
      kind,
    });
    setCorrectionOpen(false);
    setCorrectionMessage(kind === 'finished' ? 'Resolved. Tabscope will stop carrying this forward.' : kind === 'not-now' ? 'Got it — this was chosen time, not accidental drift.' : 'Thanks — the reflection has been corrected.');
    if (kind === 'finished') setResolved(true);
    if (kind !== 'not-now' && kind !== 'finished' && mission.id === primaryMission.id && analysis.missions.length > 1) setMissionIndex((current) => (current + 1) % analysis.missions.length);
  };

  const returnToMission = async () => {
    if (!isChromeExtension()) {
      setCorrectionMessage(`Preview: this would return you to ${focusPhrase(primaryMission.title)}.`);
      return;
    }
    try {
      const current = preprocessTabs(await collectCurrentTabs());
      const evidenceHashes = new Set(data.tabs.filter((tab) => primaryMission.evidenceTabIds.includes(tab.id)).map((tab) => tab.urlHash));
      const evidenceDomains = new Set(primaryMission.representativeTabs.map((tab) => tab.domain));
      const target = current.tabs
        .filter((tab) => evidenceHashes.has(tab.urlHash) || evidenceDomains.has(tab.domain))
        .filter((tab) => tab.browserTabId !== undefined)
        .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
      if (target?.browserTabId === undefined) throw new Error('That thread has changed since this reflection. Reflect again first.');
      await activateBrowserTab(target.browserTabId);
    } catch (error) {
      setCorrectionMessage(error instanceof Error ? error.message : 'The current tabs could not be matched.');
    }
  };

  return (
    <main className="chrome-page">
      <section className={`chrome-ntp attention-page reveal ${revealStep >= 0 ? 'show' : ''}`}>
        <header className="attention-heading">
          <div><strong>{freshness(status.lastUpdatedAt ?? analysis.generatedAt)}</strong><span>Observed on this device</span></div>
          {settingsLoaded && isChromeExtension() && <button className={`live-status-button ${settings.enabled ? 'on' : ''}`} onClick={() => setSettingsOpen(true)}><i /> {settings.enabled ? 'Live' : 'Live off'} <Settings2 size={15} /></button>}
        </header>

        <article className="attention-hero">
          <p>{deservesInterruption ? 'A pattern worth interrupting' : 'A pattern worth noticing'}</p>
          <h1>{headline}</h1>
          <div>{explanation}</div>
          <div className="attention-actions">
            <button className="chrome-action-button" onClick={() => void returnToMission()}>Return to {domains[0] ? domainName(domains[0]) : 'this thread'}</button>
            <button className="chrome-secondary-button" onClick={() => void recordCorrection('not-now', primaryMission)}>This was intentional</button>
          </div>
          {correctionMessage && <div className="attention-response"><Check size={15} /> {correctionMessage}</div>}
        </article>

        <div className="attention-lower">
          <section className="attention-time">
            <p>{visibleAttention.length ? `Where the last ${formatAttention(totalAttention)} went` : 'Where your active browser time will appear'}</p>
            {visibleAttention.length ? <>
              <div className="attention-bar">{visibleAttention.map((entry, index) => <i className={`attention-segment segment-${index + 1}`} key={entry.domain} style={{ width: `${(entry.totalMs / totalAttention) * 100}%` }} />)}</div>
              <div className="attention-legend">{visibleAttention.map((entry, index) => <span className={`legend-${index + 1}`} key={entry.domain}>{domainName(entry.domain)} · {formatAttention(entry.totalMs)}</span>)}</div>
            </> : <div className="attention-empty">Timing begins quietly as you move between normal web tabs.</div>}
          </section>

          <section className="attention-loop">
            <p>Still unresolved</p>
            <div className={resolved ? 'resolved' : ''}>
              <strong>{resolved ? 'Resolved just now.' : openQuestion?.title ?? `What would make “${primaryMission.title}” resolved?`}</strong>
              <span>{resolved ? 'Tabscope will stop carrying this question into later reflections.' : openQuestion?.description ?? `${primaryMission.tabCount} related tabs are still open.`}</span>
              {!resolved && <button onClick={() => void recordCorrection('finished', primaryMission)}>Mark this resolved</button>}
            </div>
          </section>
        </div>

        <footer className="attention-footer">
          <div><button onClick={() => setDetailsOpen(true)}>Why this?</button><button onClick={() => setCorrectionOpen(true)}>Not quite</button>{looseCount > 0 && <button onClick={() => setCleanupOpen(true)}>Review {looseCount} tabs</button>}</div>
          <span>{notice ?? 'Active-tab time stays on this device'} · Tabscope never reads page contents</span>
        </footer>
      </section>

      <ReflectionDetails open={detailsOpen} onClose={() => setDetailsOpen(false)} analysis={analysis} />
      <CleanupReview open={cleanupOpen} onClose={() => setCleanupOpen(false)} analysis={analysis} data={data} />
      <LiveSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} status={status} onChange={updateSettings} onRefresh={onRefresh} />
      <CorrectionModal open={correctionOpen} onClose={() => setCorrectionOpen(false)} mission={primaryMission} onSelect={(kind) => void recordCorrection(kind, primaryMission)} />
    </main>
  );
}
