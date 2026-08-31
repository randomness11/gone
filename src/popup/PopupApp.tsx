import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Brand } from '../components/Brand';
import { loadCurrentSession } from '../lib/storage';
import { collectCurrentTabs, hasTabsPermission, isChromeExtension } from '../lib/tabs';

export function PopupApp() {
  const [tabCount, setTabCount] = useState<number>();
  const [mission, setMission] = useState<string>();

  useEffect(() => {
    void Promise.all([hasTabsPermission(), loadCurrentSession()]).then(async ([permission, session]) => {
      setMission(session?.analysis?.missions[0]?.title);
      setTabCount(permission ? (await collectCurrentTabs()).length : session?.tabCount);
    });
  }, []);

  const openDashboard = () => {
    if (isChromeExtension()) chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' }, () => window.close());
    else window.open('/dashboard.html', '_blank');
  };

  return (
    <main className="popup-shell">
      <div className="popup-top">
        <Brand />
        {tabCount !== undefined && <span className="popup-status">{tabCount} tabs open</span>}
      </div>
      <section className="popup-mission">
        <span>Current thread</span>
        <h2>{mission ?? 'Your tabs haven’t been read yet.'}</h2>
        <p>{mission ? 'A reflection based on what is open right now.' : 'Open GONE to get your first private reflection.'}</p>
      </section>
      <button className="chrome-action-button popup-action" onClick={openDashboard}>{mission ? 'Open GONE' : 'Get started'} <ArrowRight size={16} /></button>
      <p className="popup-foot">Page contents are never read</p>
    </main>
  );
}
