import { useEffect, useMemo, useState } from 'react';
import { summarizeAttention } from '../../lib/attention';
import { ATTENTION_LEDGER, loadAttentionLedger } from '../../lib/storage';
import { isChromeExtension } from '../../lib/tabs';
import type { AttentionLedger } from '../../types';

type RangeKey = 'hour' | 'three-hours' | 'today';

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'hour', label: 'Last hour' },
  { key: 'three-hours', label: 'Last 3 hours' },
  { key: 'today', label: 'Today' },
];

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

function rangeStart(range: RangeKey, now: number): number {
  if (range === 'hour') return now - 60 * 60_000;
  if (range === 'three-hours') return now - 3 * 60 * 60_000;
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
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
  const [range, setRange] = useState<RangeKey>('hour');
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

  const summary = useMemo(() => summarizeAttention(ledger, rangeStart(range, now), now), [ledger, now, range]);
  const visible = summary.entries.slice(0, 8);
  const top = visible[0];
  const observedEnough = summary.totalMs >= 30_000 && Boolean(top);
  const rangeLabel = RANGES.find((item) => item.key === range)?.label ?? 'Last hour';

  return (
    <main className="mirror-page">
      <section className="mirror-shell">
        <header className="mirror-heading">
          <div><strong>Your browser time</strong><span>Active tabs · stored on this device</span></div>
          <div className="mirror-ranges" role="group" aria-label="Time range">
            {RANGES.map((item) => <button key={item.key} className={range === item.key ? 'selected' : ''} onClick={() => setRange(item.key)}>{item.label}</button>)}
          </div>
        </header>

        {observedEnough ? <>
          <article className="mirror-hero">
            <p>{rangeLabel}</p>
            <h1>{formatDuration(summary.totalMs)} observed.</h1>
            <div><strong>{domainName(top.domain)}</strong> held the largest share at {formatDuration(top.totalMs)}{visible.length > 1 ? `, followed by ${domainName(visible[1].domain)}.` : '.'}</div>
          </article>

          <section className="mirror-breakdown" aria-label={`${rangeLabel} attention breakdown`}>
            {visible.map((entry, index) => (
              <div className="mirror-row" key={entry.domain}>
                <span className={`mirror-dot mirror-dot-${(index % 5) + 1}`} />
                <strong>{domainName(entry.domain)}</strong>
                <div className="mirror-track"><i className={`mirror-fill mirror-fill-${(index % 5) + 1}`} style={{ width: `${Math.max(3, (entry.totalMs / top.totalMs) * 100)}%` }} /></div>
                <span>{formatDuration(entry.totalMs)}</span>
              </div>
            ))}
          </section>

          <footer className="mirror-summary">
            <span>{visible.length} {visible.length === 1 ? 'place' : 'places'}</span>
            <span>{summary.switchCount} observed {summary.switchCount === 1 ? 'switch' : 'switches'}</span>
            <span>{Math.round((top.totalMs / summary.totalMs) * 100)}% went to {domainName(top.domain)}</span>
          </footer>
        </> : <article className="mirror-empty">
          <p>{rangeLabel}</p>
          <h1>Nothing to reflect yet.</h1>
          <div>Browse normally. Tabscope will show where the time actually went—without deciding what it means.</div>
        </article>}

        <p className="mirror-privacy">Observed active-tab time only. No page contents, keystrokes, or browser history.</p>
      </section>
    </main>
  );
}
