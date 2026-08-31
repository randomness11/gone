import { Check, ChevronDown, Clock3, Focus, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { buildBrowserPortrait, type PortraitCharacter } from '../../lib/portrait';
import { preprocessTabs } from '../../lib/preprocessing';
import {
  BROWSER_MEMORY,
  DEFAULT_LIVE_SETTINGS,
  LIVE_SETTINGS,
  LIVE_STATUS,
  clearTabscopeMemory,
  loadBrowserMemory,
  loadLiveSettings,
  loadLiveStatus,
  saveLiveSettings,
  saveReflectionFeedback,
} from '../../lib/storage';
import { collectCurrentTabs, focusBrowserTabs, isChromeExtension } from '../../lib/tabs';
import type {
  AnalysisResult,
  BrowserMemory,
  FeedbackKind,
  LiveReflectionSettings,
  LiveReflectionStatus,
  PreprocessedTabs,
} from '../../types';

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

function domainInitial(domain: string): string {
  return domain.replace(/^www\./, '').charAt(0).toUpperCase() || '?';
}

function PortraitSettings({
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
  const clearPortrait = async () => {
    if (!clearReady) {
      setClearReady(true);
      return;
    }
    await clearTabscopeMemory();
    window.location.reload();
  };

  return (
    <Modal open={open} onClose={onClose} title="How Tabscope grows">
      <div className="live-settings">
        <div className="settings-row">
          <div><strong>Keep the portrait growing</strong><p>Notice meaningful changes while Chrome is open.</p></div>
          <button className={`chrome-switch ${settings.enabled ? 'on' : ''}`} role="switch" aria-checked={settings.enabled} onClick={() => void onChange({ enabled: !settings.enabled })}><i /></button>
        </div>
        <div className="settings-section">
          <label>Look again every</label>
          <div className="settings-segmented">
            {([10, 30, 60] as const).map((minutes) => <button key={minutes} className={settings.intervalMinutes === minutes ? 'selected' : ''} onClick={() => void onChange({ intervalMinutes: minutes })}>{minutes === 60 ? '1 hour' : `${minutes} min`}</button>)}
          </div>
          <p>Tabscope stores up to 30 days of compact thread patterns locally. It does not store page contents.</p>
        </div>
        <div className="settings-status"><Clock3 size={16} /><div><strong>{status.state === 'checking' ? 'Looking quietly…' : freshness(status.lastCheckedAt ?? status.lastUpdatedAt)}</strong><p>{status.lastError ?? status.lastChangeReason?.replaceAll('-', ' ') ?? 'The portrait is current'}</p></div></div>
        <div className="settings-actions"><button className="chrome-action-button" onClick={onRefresh}>Look again now</button></div>
        <button className={`clear-memory-button ${clearReady ? 'confirm' : ''}`} onClick={() => void clearPortrait()}>{clearReady ? 'Confirm: begin the portrait again' : 'Clear portrait memory'}</button>
      </div>
    </Modal>
  );
}

export function PortraitView({
  analysis,
  data,
  notice,
  onRefresh,
}: {
  analysis: AnalysisResult;
  data: PreprocessedTabs;
  notice?: string;
  onRefresh: () => void;
}) {
  const [memory, setMemory] = useState<BrowserMemory>();
  const [settings, setSettings] = useState<LiveReflectionSettings>(DEFAULT_LIVE_SETTINGS);
  const [status, setStatus] = useState<LiveReflectionStatus>({ state: 'idle' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>();
  const [focusWorking, setFocusWorking] = useState<string>();
  const [focusMessage, setFocusMessage] = useState<string>();
  const portrait = useMemo(() => buildBrowserPortrait(analysis, data, memory), [analysis, data, memory]);

  useEffect(() => {
    void Promise.all([loadBrowserMemory(), loadLiveSettings(), loadLiveStatus()]).then(([nextMemory, nextSettings, nextStatus]) => {
      setMemory(nextMemory);
      setSettings(nextSettings);
      setStatus(nextStatus);
    });
    if (!isChromeExtension()) return;
    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[BROWSER_MEMORY]?.newValue) setMemory(changes[BROWSER_MEMORY].newValue as BrowserMemory);
      if (changes[LIVE_SETTINGS]?.newValue) setSettings({ ...DEFAULT_LIVE_SETTINGS, ...changes[LIVE_SETTINGS].newValue as LiveReflectionSettings });
      if (changes[LIVE_STATUS]?.newValue) setStatus(changes[LIVE_STATUS].newValue as LiveReflectionStatus);
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  const updateSettings = async (patch: Partial<LiveReflectionSettings>) => {
    const next = { ...settings, ...patch, promptDismissed: true };
    setSettings(next);
    await saveLiveSettings(next);
    if (isChromeExtension()) void chrome.runtime.sendMessage({ type: 'SYNC_LIVE_ALARM' });
  };

  const recordFeedback = async (kind: Extract<FeedbackKind, 'right' | 'partly' | 'wrong'>) => {
    const primary = analysis.missions[0];
    if (!primary) return;
    await saveReflectionFeedback({
      id: `portrait_feedback_${Date.now()}`,
      createdAt: Date.now(),
      sessionId: `session_${data.generatedAt}`,
      missionTitle: primary.title,
      kind,
    });
    setFeedbackMessage(kind === 'right' ? 'Tabscope will remember that this felt true.' : kind === 'partly' ? 'Got it — keep the pattern, soften the conclusion.' : 'Got it — this does not belong in your portrait.');
  };

  const focusCharacter = async (character: PortraitCharacter) => {
    if (!isChromeExtension()) {
      setFocusMessage('Tab grouping is available in the installed extension.');
      return;
    }
    setFocusWorking(character.key);
    setFocusMessage(undefined);
    try {
      const current = preprocessTabs(await collectCurrentTabs());
      const evidenceHashes = new Set(data.tabs.filter((tab) => character.evidenceTabIds.includes(tab.id)).map((tab) => tab.urlHash));
      const domains = new Set(character.domains);
      const ids = current.tabs
        .filter((tab) => evidenceHashes.has(tab.urlHash) || (!evidenceHashes.size && domains.has(tab.domain)))
        .flatMap((tab) => tab.browserTabId === undefined ? [] : [tab.browserTabId]);
      if (!ids.length) throw new Error('Those tabs have changed since this portrait. Look again first.');
      await focusBrowserTabs(ids, character.label.replace(/^The /, ''));
      setFocusMessage(`${ids.length} ${ids.length === 1 ? 'tab is' : 'tabs are'} now together.`);
    } catch (error) {
      setFocusMessage(error instanceof Error ? error.message : 'Chrome could not bring that thread together.');
    } finally {
      setFocusWorking(undefined);
    }
  };

  return (
    <main className="portrait-page">
      <section className="portrait-shell">
        <header className="portrait-heading">
          <div className="portrait-heading-copy"><span>{daypart()}</span><small>{freshness(status.lastUpdatedAt ?? analysis.generatedAt)}</small></div>
          {isChromeExtension() && <button className={`portrait-live ${settings.enabled ? 'on' : ''}`} onClick={() => setSettingsOpen(true)}><i /> {settings.enabled ? 'Growing quietly' : 'Growth paused'} <Settings2 size={15} /></button>}
        </header>

        <article className="portrait-statement">
          <p>{portrait.eyebrow}</p>
          <h1>{portrait.headline}</h1>
          <div className="portrait-detail">{portrait.detail}</div>
        </article>

        <div className={`portrait-characters character-count-${portrait.characters.length}`}>
          {portrait.characters.map((character, index) => (
            <article className="portrait-character" key={character.key} style={{ animationDelay: `${180 + index * 120}ms` }}>
              <div className="character-orbit" aria-hidden="true">
                {(character.domains.length ? character.domains : ['?']).slice(0, 4).map((domain, domainIndex) => <span key={`${domain}-${domainIndex}`}>{domainInitial(domain)}</span>)}
              </div>
              <small>{character.tabCount} {character.tabCount === 1 ? 'tab' : 'tabs'}</small>
              <h2>{character.label}</h2>
              <p>{character.domains.join(' · ') || 'A thread still taking shape'}</p>
              <button className="character-focus" onClick={() => void focusCharacter(character)} disabled={focusWorking === character.key}><Focus size={14} /> {focusWorking === character.key ? 'Bringing it together…' : 'Bring these tabs together'}</button>
            </article>
          ))}
        </div>

        <button className={`portrait-evidence-toggle ${evidenceOpen ? 'open' : ''}`} onClick={() => setEvidenceOpen((current) => !current)}><span>See what led to this</span><ChevronDown size={16} /></button>
        {evidenceOpen && <section className="portrait-evidence">
          {portrait.characters.map((character) => <div className="portrait-evidence-row" key={character.key}><strong>{character.label}</strong><div>{character.evidenceTitles.length ? character.evidenceTitles.map((title) => <span key={title}>{title}</span>) : <span>No single tab carries this pattern.</span>}</div></div>)}
        </section>}

        <aside className="portrait-growth">
          <span><Sparkles size={17} /></span>
          <div><small>{portrait.growthLabel}</small><strong>{portrait.growthNote}</strong></div>
        </aside>

        {focusMessage && <div className="portrait-message">{focusMessage}</div>}
        {feedbackMessage ? <div className="portrait-feedback-done"><Check size={15} /> {feedbackMessage}</div> : <div className="portrait-feedback"><span>Does this feel true?</span><button onClick={() => void recordFeedback('right')}>That’s me</button><button onClick={() => void recordFeedback('partly')}>Partly</button><button onClick={() => void recordFeedback('wrong')}>Not quite</button></div>}

        <footer className="portrait-footer">
          <span>{portrait.snapshotCount <= 1 ? 'The portrait starts here' : `${portrait.snapshotCount} reflections remembered locally`}</span>
          <span>{notice ?? 'A suggestion, not a verdict'} · Tabscope never reads page contents</span>
        </footer>
      </section>

      <PortraitSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} status={status} onChange={updateSettings} onRefresh={onRefresh} />
    </main>
  );
}
