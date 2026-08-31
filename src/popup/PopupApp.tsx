import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Brand } from '../components/Brand';
import { describeMissionCharacter } from '../lib/portrait';
import { loadCurrentSession } from '../lib/storage';
import { collectCurrentTabs, hasTabsPermission, isChromeExtension } from '../lib/tabs';

export function PopupApp() {
  const [tabCount, setTabCount] = useState<number>();
  const [mission, setMission] = useState<string>();

  useEffect(() => {
    void Promise.all([hasTabsPermission(), loadCurrentSession()]).then(async ([permission, session]) => {
      const primary = session?.analysis?.missions[0];
      setMission(primary ? describeMissionCharacter(primary).label : undefined);
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
        <span>Your browser right now</span>
        <h2>{mission ?? 'Your tabs haven’t been read yet.'}</h2>
        <p>{mission ? 'One character in the portrait Tabscope is building with you.' : 'Open Tabscope to meet the versions of you inside your browser.'}</p>
      </section>
      <button className="chrome-action-button popup-action" onClick={openDashboard}>{mission ? 'Open Tabscope' : 'Get started'} <ArrowRight size={16} /></button>
      <p className="popup-foot">Page contents are never read</p>
    </main>
  );
}
