import { ArrowRight, Eye, LockKeyhole, RefreshCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Brand } from '../components/Brand';
import { Modal } from '../components/Modal';
import { CURRENT_SESSION } from '../lib/storage';
import { isChromeExtension } from '../lib/tabs';
import { AnalysisView } from './components/AnalysisView';
import { useDashboardStore } from './store';

function PrivacyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="The honest privacy version">
      <div className="privacy-copy">
        <p className="modal-lede">Tabscope reads metadata, not pages.</p>
        <div className="privacy-row">
          <span>Stays on device</span>
          <p>Raw URLs, query parameters, fragments, browser tab IDs, duplicate detection, and your saved result.</p>
        </div>
        <div className="privacy-row">
          <span>May reach your model</span>
          <p>Redacted titles, normalized domains, synthetic window/group labels, pinned/active state, and coarse age buckets such as “today” or “older.”</p>
        </div>
        <div className="privacy-row">
          <span>Never read in v0</span>
          <p>Page contents, form inputs, cookies, passwords, browsing history, or the text inside your tabs.</p>
        </div>
        <p className="fine-print">Sensitive query parameters, fragments, emails, obvious tokens, long opaque IDs, and secret-like values are stripped before inference.</p>
      </div>
    </Modal>
  );
}

function PermissionScreen({
  error,
  onAnalyze,
  onDemo,
}: {
  error?: string;
  onAnalyze: () => void;
  onDemo: () => void;
}) {
  return (
    <main className="permission-screen">
      <section className="chrome-onboarding">
        <span className="chrome-onboarding-icon"><Brand /></span>
        <div className="chrome-onboarding-copy">
          <h1>See what your open tabs are adding up to</h1>
          <p>Tabscope finds the threads you keep returning to and offers one useful next step.</p>
          {error && <p className="inline-error">{error}</p>}
        </div>
        <div className="chrome-permission-note">
          <LockKeyhole size={18} />
          <div>
            <strong>Your pages stay private</strong>
            <p>Tabscope uses tab titles and cleaned URL hints. It never reads page contents.</p>
          </div>
        </div>
        <div className="chrome-onboarding-actions">
          <button className="chrome-secondary-button" onClick={onDemo}>Preview</button>
          <button className="chrome-action-button" onClick={onAnalyze}>Continue <ArrowRight size={16} /></button>
        </div>
      </section>
    </main>
  );
}

function AnalyzingScreen() {
  const [messageIndex, setMessageIndex] = useState(0);
  const messages = [
    'Taking a private glance',
    'Finding the threads between your tabs',
    'Noticing what keeps pulling you back',
    'Reflecting it back, gently',
  ];

  useEffect(() => {
    const timer = window.setInterval(() => setMessageIndex((current) => Math.min(current + 1, messages.length - 1)), 430);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  return (
    <main className="analyzing-screen">
      <div className="analysis-orbit" aria-hidden="true"><i /><i /><i /><span /></div>
      <p className="eyebrow">Looking for the shape of what’s on your mind</p>
      <h1>{messages[messageIndex]}<span className="ellipsis">…</span></h1>
      <div className="analysis-progress"><i style={{ width: `${(messageIndex + 1) * 25}%` }} /></div>
      <p>Only sanitized metadata is being analyzed.</p>
    </main>
  );
}

function ErrorScreen({ error, retry }: { error?: string; retry: () => void }) {
  return (
    <main className="state-screen">
      <p className="eyebrow">We lost the thread</p>
      <h1>Nothing wrong on your side.<br />Let’s try that again.</h1>
      <p>{error}</p>
      <button className="primary-button" onClick={retry}><RefreshCcw size={16} /> Try again</button>
    </main>
  );
}

export function DashboardApp() {
  const {
    stage,
    analysis,
    data,
    previousSession,
    error,
    notice,
    revealStep,
    initialize,
    runAnalysis,
    syncCurrentSession,
    setRevealStep,
  } = useDashboardStore();
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isChromeExtension()) return;
    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[CURRENT_SESSION]?.newValue) void syncCurrentSession();
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, [syncCurrentSession]);

  useEffect(() => {
    if (stage !== 'results' || revealStep >= 5) return;
    const timer = window.setTimeout(() => setRevealStep(revealStep + 1), revealStep === 0 ? 180 : 240);
    return () => window.clearTimeout(timer);
  }, [revealStep, setRevealStep, stage]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          {stage === 'results' && <button className="topbar-button" onClick={() => void runAnalysis(false)}><RefreshCcw size={14} /> Reflect again</button>}
          <button className="topbar-button" onClick={() => setPrivacyOpen(true)}><Eye size={14} /> Privacy</button>
        </div>
      </header>

      {stage === 'booting' && <AnalyzingScreen />}
      {stage === 'permission' && <PermissionScreen error={error} onAnalyze={() => void runAnalysis(false)} onDemo={() => void runAnalysis(true)} />}
      {stage === 'analyzing' && <AnalyzingScreen />}
      {stage === 'error' && <ErrorScreen error={error} retry={() => void runAnalysis(!isChromeExtension())} />}
      {stage === 'results' && analysis && data && (
        <AnalysisView
          analysis={analysis}
          data={data}
          previousSession={previousSession}
          notice={notice}
          revealStep={revealStep}
          onRefresh={() => void runAnalysis(false)}
        />
      )}

      <PrivacyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}
