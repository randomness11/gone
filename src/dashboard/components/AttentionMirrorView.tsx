import { useEffect, useMemo, useState } from 'react';
import { summarizeAttention } from '../../lib/attention';
import { ATTENTION_LEDGER, loadAttentionLedger } from '../../lib/storage';
import { isChromeExtension } from '../../lib/tabs';
import type { AttentionLedger } from '../../types';

type RangeKey = 'hour' | 'three-hours' | 'today';

const RANGES: Array<{ key: RangeKey; label: string; sentence: string }> = [
  { key: 'hour', label: 'Last hour', sentence: 'In the last hour' },
  { key: 'three-hours', label: 'Last 3 hours', sentence: 'In the last 3 hours' },
  { key: 'today', label: 'Today', sentence: 'Today' },
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

function formatClock(time: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(time);
}

function rangeStart(range: RangeKey, now: number): number {
  if (range === 'hour') return now - 60 * 60_000;
  if (range === 'three-hours') return now - 3 * 60 * 60_000;
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function faviconUrl(domain: string, size = 32): string | undefined {
  if (!isChromeExtension()) return undefined;
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', `https://${domain}/`);
  url.searchParams.set('size', String(size));
  return url.toString();
}

function SiteFavicon({ domain, index = 0, inline = false }: { domain: string; index?: number; inline?: boolean }) {
  const name = domainName(domain);
  const source = faviconUrl(domain, inline ? 64 : 32);
  return (
    <span
      className={`mirror-favicon mirror-favicon-${(index % 5) + 1}${inline ? ' mirror-inline-favicon' : ''}`}
      role={inline ? 'img' : undefined}
      aria-label={inline ? name : undefined}
      title={inline ? name : undefined}
      aria-hidden={inline ? undefined : true}
    >
      <span aria-hidden="true">{name.charAt(0)}</span>
      {source && <img src={source} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
    </span>
  );
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
  const visible = summary.entries.slice(0, 6);
  const top = summary.entries[0];
  const second = summary.entries[1];
  const observedEnough = summary.totalMs >= 30_000 && Boolean(top);
  const selectedRange = RANGES.find((item) => item.key === range) ?? RANGES[0];
  const emptyPeriod = range === 'today' ? 'today' : range === 'hour' ? 'in the last hour' : 'in the last 3 hours';
  const emptyReflection = `Nothing observed ${emptyPeriod} yet.`;

  return (
    <main className="mirror-page">
      <section className="mirror-shell mirror-single">
        <header className="mirror-heading">
          <div><strong>Where your browser time went</strong><span>Across focused Chrome windows</span></div>
          <div className="mirror-ranges" role="group" aria-label="Time range">
            {RANGES.map((item) => <button key={item.key} className={range === item.key ? 'selected' : ''} onClick={() => setRange(item.key)}>{item.label}</button>)}
          </div>
        </header>
        <p className="mirror-kicker">Your browser, reflected</p>
        <h1 className="mirror-line">
          {observedEnough ? <>
            {selectedRange.sentence}, {formatDuration(top.totalMs)} of observed time went to <SiteFavicon domain={top.domain} inline />
            {second && <> and {formatDuration(second.totalMs)} to <SiteFavicon domain={second.domain} index={1} inline /></>}.
          </> : emptyReflection}
        </h1>
        {observedEnough && summary.firstObservedAt !== undefined && summary.lastObservedAt !== undefined && <p className="mirror-span">
          Chrome activity observed from <strong>{formatClock(summary.firstObservedAt)}</strong> to <strong>{formatClock(summary.lastObservedAt)}</strong>
          <span> · {formatDuration(summary.totalMs)} total · {summary.switchCount} {summary.switchCount === 1 ? 'switch' : 'switches'}</span>
        </p>}
        {observedEnough && <section className="mirror-breakdown mirror-hour-chart" aria-label={`${selectedRange.label} attention breakdown`}>
          {visible.map((entry, index) => (
            <div className="mirror-row" key={entry.domain}>
              <SiteFavicon domain={entry.domain} index={index} />
              <strong>{domainName(entry.domain)}</strong>
              <div className="mirror-track"><i className={`mirror-fill mirror-fill-${(index % 5) + 1}`} style={{ width: `${Math.max(3, (entry.totalMs / top.totalMs) * 100)}%` }} /></div>
              <span>{formatDuration(entry.totalMs)}</span>
            </div>
          ))}
        </section>}
        <p className="mirror-privacy">Observed active-tab time · stored on this device</p>
      </section>
    </main>
  );
}
