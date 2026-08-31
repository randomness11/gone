import { ArrowRight, Check, Clock3, Focus, History, Layers3, Pause, RefreshCcw, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { preprocessTabs } from '../../lib/preprocessing';
import {
  clearTabscopeMemory,
  DEFAULT_LIVE_SETTINGS,
  LIVE_SETTINGS,
  LIVE_STATUS,
  loadLiveSettings,
  loadLiveStatus,
  saveLiveSettings,
  saveReflectionFeedback,
} from '../../lib/storage';
import { closeTabsByBrowserId, collectCurrentTabs, focusBrowserTabs, isChromeExtension } from '../../lib/tabs';
import type {
  AnalysisResult,
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

function gentleNextStep(mission?: Mission): string {
  if (!mission?.nextAction) {
    return 'Maybe choose the one open tab that could move this forward, and let the rest wait for now.';
  }
  const action = mission.nextAction.trim().replace(/[.!]$/, '');
  return `Maybe ${lowerFirst(action)}.`;
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

function daypart(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function missionDomains(mission: Mission): string[] {
  return [...new Set(mission.representativeTabs.map((tab) => tab.domain))].slice(0, 3);
}

function describeChange(previousSession: Session | undefined, data: PreprocessedTabs, mission: Mission) {
  if (!previousSession) {
    return {
      label: 'A starting point',
      headline: 'This is the first shape Tabscope has saved.',
      detail: 'After something meaningfully changes, this space will show what arrived and what left.',
    };
  }

  const previousHashes = new Set(previousSession.snapshots.map((snapshot) => snapshot.urlHash));
  const currentHashes = new Set(data.tabs.map((tab) => tab.urlHash));
  const addedTabs = data.tabs.filter((tab) => !previousHashes.has(tab.urlHash));
  const removed = previousSession.snapshots.filter((snapshot) => !currentHashes.has(snapshot.urlHash)).length;
  const missionIds = new Set(mission.evidenceTabIds);
  const joinedMission = addedTabs.filter((tab) => missionIds.has(tab.id));
  const newDomains = [...new Set(addedTabs.map((tab) => tab.domain).filter((domain) => domain !== 'unknown'))].slice(0, 3);
  const comparison = freshness(previousSession.createdAt).replace('Updated', 'Compared with');

  if (joinedMission.length) {
    return {
      label: comparison,
      headline: `${joinedMission.length} new ${joinedMission.length === 1 ? 'tab has' : 'tabs have'} joined this thread.`,
      detail: newDomains.length ? `The new material came from ${newDomains.join(', ')}.` : 'The thread has gathered a little more context.',
    };
  }
  if (removed > addedTabs.length && removed > 0) {
    return {
      label: comparison,
      headline: `You let ${removed} ${removed === 1 ? 'tab' : 'tabs'} go.`,
      detail: addedTabs.length ? `${addedTabs.length} ${addedTabs.length === 1 ? 'new tab appeared' : 'new tabs appeared'} at the same time.` : 'The browser is carrying a little less than before.',
    };
  }
  if (addedTabs.length) {
    return {
      label: comparison,
      headline: `${addedTabs.length} ${addedTabs.length === 1 ? 'new tab has' : 'new tabs have'} appeared.`,
      detail: newDomains.length ? `They came from ${newDomains.join(', ')}.` : 'They have not formed a clear new thread yet.',
    };
  }
  return {
    label: comparison,
    headline: 'The shape of your browser has stayed steady.',
    detail: removed ? `${removed} ${removed === 1 ? 'tab has' : 'tabs have'} quietly left.` : 'Nothing meaningful has arrived or disappeared.',
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

function FocusModal({
  open,
  onClose,
  mission,
  onConfirm,
  working,
  message,
}: {
  open: boolean;
  onClose: () => void;
  mission?: Mission;
  onConfirm: () => void;
  working: boolean;
  message?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Focus on this thread">
      <div className="focus-panel">
        <span className="focus-panel-icon"><Focus size={22} /></span>
        <h3>{mission?.title}</h3>
        <p>Tabscope will place the tabs supporting this thread into one visible Chrome tab group. It will not close or hide anything else.</p>
        {message && <div className="focus-message">{message}</div>}
        <div className="focus-actions"><button className="chrome-secondary-button" onClick={onClose}>Cancel</button><button className="chrome-action-button" onClick={onConfirm} disabled={working}>{working ? 'Grouping…' : 'Create focus group'}</button></div>
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

export function AnalysisView({ analysis, data, previousSession, notice, revealStep, onRefresh }: {
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
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusWorking, setFocusWorking] = useState(false);
  const [focusMessage, setFocusMessage] = useState<string>();
  const [focusIds, setFocusIds] = useState<number[]>([]);
  const [focusMission, setFocusMission] = useState<Mission>();
  const [missionIndex, setMissionIndex] = useState(0);
  const [correctionMessage, setCorrectionMessage] = useState<string>();
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settings, setSettings] = useState<LiveReflectionSettings>(DEFAULT_LIVE_SETTINGS);
  const [status, setStatus] = useState<LiveReflectionStatus>({ state: 'idle' });
  const primaryMission = analysis.missions[missionIndex] ?? analysis.missions[0];
  const waitingMissions = analysis.missions.filter((mission) => mission.id !== primaryMission.id).slice(0, 2);
  const looseCount = analysis.cleanup.filter((item) => item.classification === 'redundant' || item.classification === 'stale').length;
  const domains = missionDomains(primaryMission);
  const change = describeChange(previousSession, data, primaryMission);
  const openQuestion = analysis.openLoops[0];
  const observation = analysis.surprisingObservations[0];

  useEffect(() => {
    void Promise.all([loadLiveSettings(), loadLiveStatus()]).then(([nextSettings, nextStatus]) => {
      setSettings(nextSettings);
      setStatus(nextStatus);
      setSettingsLoaded(true);
    });
    if (!isChromeExtension()) return;
    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[LIVE_SETTINGS]?.newValue) setSettings({ ...DEFAULT_LIVE_SETTINGS, ...changes[LIVE_SETTINGS].newValue as LiveReflectionSettings });
      if (changes[LIVE_STATUS]?.newValue) setStatus(changes[LIVE_STATUS].newValue as LiveReflectionStatus);
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  useEffect(() => { setMissionIndex(0); }, [analysis.generatedAt]);

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
    setCorrectionMessage(kind === 'finished' ? 'Got it — that thread is complete.' : kind === 'not-now' ? 'Got it — this can wait.' : 'Thanks — the reflection has been corrected.');
    if (mission.id === primaryMission.id && analysis.missions.length > 1) setMissionIndex((current) => (current + 1) % analysis.missions.length);
  };

  const prepareFocus = async (mission = primaryMission) => {
    setFocusMission(mission);
    setFocusMessage(undefined);
    setFocusIds([]);
    if (!isChromeExtension()) {
      setFocusMessage('Focus groups are available in the installed extension.');
      setFocusOpen(true);
      return;
    }
    try {
      const current = preprocessTabs(await collectCurrentTabs());
      const evidenceHashes = new Set(data.tabs.filter((tab) => mission.evidenceTabIds.includes(tab.id)).map((tab) => tab.urlHash));
      const evidenceDomains = new Set(mission.representativeTabs.map((tab) => tab.domain));
      const matching = current.tabs.filter((tab) => evidenceHashes.has(tab.urlHash) || (!evidenceHashes.size && evidenceDomains.has(tab.domain)));
      const ids = matching.flatMap((tab) => tab.browserTabId === undefined ? [] : [tab.browserTabId]);
      setFocusIds(ids);
      if (!ids.length) setFocusMessage('Those tabs have changed since this reflection. Reflect again first.');
    } catch (error) {
      setFocusMessage(error instanceof Error ? error.message : 'The current tabs could not be matched.');
    }
    setFocusOpen(true);
  };

  const confirmFocus = async () => {
    if (!focusIds.length) return;
    const mission = focusMission ?? primaryMission;
    setFocusWorking(true);
    try {
      await focusBrowserTabs(focusIds, mission.title);
      setFocusMessage(`${focusIds.length} ${focusIds.length === 1 ? 'tab is' : 'tabs are'} now together in a focus group.`);
    } catch (error) {
      setFocusMessage(error instanceof Error ? error.message : 'Chrome could not create that group.');
    } finally {
      setFocusWorking(false);
    }
  };

  return (
    <main className="chrome-page">
      <section className={`chrome-ntp memory-page reveal ${revealStep >= 0 ? 'show' : ''}`}>
        <header className="memory-heading">
          <span className="chrome-module-icon"><Layers3 size={20} /></span>
          <div><h2>Your browser remembers</h2><p>{freshness(status.lastUpdatedAt ?? analysis.generatedAt)}</p></div>
          {settingsLoaded && isChromeExtension() && <button className={`live-status-button ${settings.enabled ? 'on' : ''}`} onClick={() => setSettingsOpen(true)}><i /> {settings.enabled ? settings.pausedUntil && settings.pausedUntil > Date.now() ? 'Paused' : 'Live' : 'Live off'} <Settings2 size={15} /></button>}
        </header>

        <div className="memory-hero-grid">
          <article className="memory-hero">
            <span className="memory-kicker">{daypart()}</span>
            <h1>You’re in the middle of <strong>{focusPhrase(primaryMission.title)}</strong>.</h1>
            <p className="memory-evidence">{primaryMission.tabCount} open {primaryMission.tabCount === 1 ? 'tab appears' : 'tabs appear'} connected{domains.length ? ` across ${domains.join(', ')}` : ''}.</p>
            <div className="memory-restart"><small>A useful place to restart</small><p>{gentleNextStep(primaryMission)}</p></div>
            <div className="memory-primary-actions">
              <button className="chrome-action-button" onClick={() => void prepareFocus(primaryMission)}><Focus size={15} /> Continue this thread</button>
              <button className="chrome-text-button" onClick={() => void recordCorrection('finished', primaryMission)}>I’m done with this</button>
            </div>
          </article>

          <aside className="memory-change-card">
            <span className="memory-change-icon"><History size={18} /></span>
            <small>{change.label}</small>
            <h3>{change.headline}</h3>
            <p>{change.detail}</p>
          </aside>
        </div>

        {settingsLoaded && isChromeExtension() && !settings.promptDismissed && <div className="live-prompt">
          <div><strong>Let Tabscope remember what changes?</strong><p>It can check locally every 10 minutes and only update when the shape of your tabs meaningfully shifts.</p></div>
          <div><button className="chrome-secondary-button" onClick={() => void updateSettings({ promptDismissed: true })}>Not now</button><button className="chrome-action-button" onClick={() => void updateSettings({ enabled: true, intervalMinutes: 10, modelMode: 'adaptive', promptDismissed: true })}>Keep it current</button></div>
        </div>}

        {correctionMessage && <div className="inline-success"><Check size={15} /> {correctionMessage}</div>}

        <div className="memory-lower-grid">
          <section className="memory-section">
            <div className="memory-section-heading"><div><h2>Waiting for you</h2><p>Other threads Tabscope can hold without putting them in your way.</p></div></div>
            <div className="memory-thread-list">
              {waitingMissions.length ? waitingMissions.map((mission) => (
                <button className="memory-thread" key={mission.id} onClick={() => void prepareFocus(mission)}>
                  <span><strong>{mission.title}</strong><small>{mission.tabCount} {mission.tabCount === 1 ? 'tab' : 'tabs'} · {missionDomains(mission).slice(0, 2).join(', ') || 'mixed sources'}</small></span>
                  <ArrowRight size={16} />
                </button>
              )) : <div className="memory-empty"><strong>Nothing else is asking for attention.</strong><p>One clear thread is enough.</p></div>}
            </div>
          </section>

          <section className="memory-section">
            <div className="memory-section-heading"><div><h2>Ready to release</h2><p>Things that may have already done their job.</p></div></div>
            <div className="memory-release-card">
              <strong>{looseCount ? `${looseCount} ${looseCount === 1 ? 'tab looks' : 'tabs look'} ready for a decision` : 'Nothing needs clearing right now'}</strong>
              <p>{looseCount ? 'Tabscope will show its reasoning. You still choose every tab.' : 'The open tabs still appear connected or intentionally kept.'}</p>
              {looseCount > 0 && <button className="chrome-secondary-button" onClick={() => setCleanupOpen(true)}>Review tabs</button>}
            </div>
          </section>
        </div>

        {(openQuestion || observation) && <aside className="memory-connection">
          <span><Sparkles size={17} /></span>
          <div><small>{openQuestion ? 'One question still open' : 'A connection worth noticing'}</small><strong>{openQuestion?.title ?? observation.text}</strong>{openQuestion && <p>{openQuestion.description}</p>}</div>
        </aside>}

        <footer className="memory-footer">
          <div><button className="chrome-text-button" onClick={() => setDetailsOpen(true)}>Why this reflection?</button><button className="chrome-text-button" onClick={() => setCorrectionOpen(true)}>Not quite</button></div>
          <span>{notice ?? 'A suggestion, not a verdict'} · Tabscope never reads page contents</span>
        </footer>
      </section>

      <ReflectionDetails open={detailsOpen} onClose={() => setDetailsOpen(false)} analysis={analysis} />
      <CleanupReview open={cleanupOpen} onClose={() => setCleanupOpen(false)} analysis={analysis} data={data} />
      <LiveSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} status={status} onChange={updateSettings} onRefresh={onRefresh} />
      <CorrectionModal open={correctionOpen} onClose={() => setCorrectionOpen(false)} mission={primaryMission} onSelect={(kind) => void recordCorrection(kind, primaryMission)} />
      <FocusModal open={focusOpen} onClose={() => setFocusOpen(false)} mission={focusMission ?? primaryMission} onConfirm={() => void confirmFocus()} working={focusWorking} message={focusMessage} />
    </main>
  );
}
