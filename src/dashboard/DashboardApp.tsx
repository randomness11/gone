import { ArrowRight, LockKeyhole, RefreshCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Brand } from '../components/Brand';
import { isChromeExtension } from '../lib/tabs';
import { AttentionMirrorView } from './components/AttentionMirrorView';
import { useDashboardStore } from './store';

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
          <h1>See where your browser time actually went</h1>
          <p>Tabscope privately measures active-tab time and reflects the last hour, last three hours, and today back to you.</p>
          {error && <p className="inline-error">{error}</p>}
        </div>
        <div className="chrome-permission-note">
          <LockKeyhole size={18} />
          <div>
            <strong>Your pages stay private</strong>
            <p>Tabscope stores active-tab time, tab titles, and cleaned URL hints locally. It never reads page contents.</p>
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
    'Starting the local clock',
    'Keeping page contents out of view',
    'Preparing your attention mirror',
    'Ready',
  ];

  useEffect(() => {
    const timer = window.setInterval(() => setMessageIndex((current) => Math.min(current + 1, messages.length - 1)), 430);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  return (
    <main className="analyzing-screen">
      <div className="analysis-orbit" aria-hidden="true"><i /><i /><i /><span /></div>
      <p className="eyebrow">Measuring time, not judging it</p>
      <h1>{messages[messageIndex]}<span className="ellipsis">…</span></h1>
      <div className="analysis-progress"><i style={{ width: `${(messageIndex + 1) * 25}%` }} /></div>
      <p>Only local tab timing is being prepared.</p>
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
    error,
    initialize,
    runAnalysis,
  } = useDashboardStore();
  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
      </header>

      {stage === 'booting' && <AnalyzingScreen />}
      {stage === 'permission' && <PermissionScreen error={error} onAnalyze={() => void runAnalysis(false)} onDemo={() => void runAnalysis(true)} />}
      {stage === 'analyzing' && <AnalyzingScreen />}
      {stage === 'error' && <ErrorScreen error={error} retry={() => void runAnalysis(!isChromeExtension())} />}
      {stage === 'results' && <AttentionMirrorView />}
    </div>
  );
}
