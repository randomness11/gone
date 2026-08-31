import { useEffect, useMemo, useState } from 'react';
import { summarizeAttention } from '../../lib/attention';
import { ATTENTION_LEDGER, loadAttentionLedger } from '../../lib/storage';
import { isChromeExtension } from '../../lib/tabs';
import type { AttentionLedger } from '../../types';

const LOOKBACK_MS = 60 * 60_000;

function domainName(domain: string): string {
  const part = domain.split('.')[0].replace(/[-_]/g, ' ');
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : domain;
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function demoLedger(now: number): AttentionLedger {
  return {
    dateKey: new Date(now).toISOString().slice(0, 10),
    updatedAt: now,
    entries: [],
    intervals: [
      { domain: 'chatgpt.com', title: 'ChatGPT', startedAt: now - 58 * 60_000, endedAt: now - 37 * 60_000 },
      { domain: 'github.com', title: 'GitHub', startedAt: now - 35 * 60_000, endedAt: now - 24 * 60_000 },
      { domain: 'x.com', title: 'X', startedAt: now - 22 * 60_000, endedAt: now - 8 * 60_000 },
      { domain: 'chatgpt.com', title: 'ChatGPT', startedAt: now - 7 * 60_000, endedAt: now - 60_000 },
    ],
  };
}

export function AttentionMirrorView() {
  const [ledger, setLedger] = useState<AttentionLedger>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void loadAttentionLedger().then((stored) => setLedger(stored ?? (!isChromeExtension() ? demoLedger(Date.now()) : undefined)));
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    if (!isChromeExtension()) return () => window.clearInterval(timer);
    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[ATTENTION_LEDGER]?.newValue) setLedger(changes[ATTENTION_LEDGER].newValue as AttentionLedger);
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => {
      window.clearInterval(timer);
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);

  const summary = useMemo(() => summarizeAttention(ledger, now - LOOKBACK_MS, now), [ledger, now]);
  const visible = summary.entries.slice(0, 6);
  const top = summary.entries[0];
  const second = summary.entries[1];
  const observedEnough = summary.totalMs >= 30_000 && Boolean(top);
  const reflection = observedEnough
    ? `In the last hour, ${formatDuration(top.totalMs)} of observed time went to ${domainName(top.domain)}${second ? ` and ${formatDuration(second.totalMs)} to ${domainName(second.domain)}` : ''}.`
    : 'Nothing observed in the last hour yet.';

  return (
    <main className="mirror-page">
      <section className="mirror-shell mirror-single">
        <p className="mirror-kicker">Your browser, reflected</p>
        <h1 className="mirror-line">{reflection}</h1>
        {observedEnough && <section className="mirror-breakdown mirror-hour-chart" aria-label="Last hour attention breakdown">
          {visible.map((entry, index) => (
            <div className="mirror-row" key={entry.domain}>
              <span className={`mirror-dot mirror-dot-${(index % 5) + 1}`} />
              <strong>{domainName(entry.domain)}</strong>
              <div className="mirror-track"><i className={`mirror-fill mirror-fill-${(index % 5) + 1}`} style={{ width: `${Math.max(3, (entry.totalMs / top.totalMs) * 100)}%` }} /></div>
              <span>{formatDuration(entry.totalMs)}</span>
            </div>
          ))}
        </section>}
        <p className="mirror-privacy">Last hour · across focused Chrome windows · stored on this device</p>
      </section>
    </main>
  );
}
