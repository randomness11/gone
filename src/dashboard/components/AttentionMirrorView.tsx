import { Clock3, Globe2, TimerReset } from 'lucide-react';
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
  const known: Record<string, string> = {
    'chatgpt.com': 'ChatGPT',
    'mail.google.com': 'Gmail',
    'web.whatsapp.com': 'WhatsApp Web',
    'en.wikipedia.org': 'Wikipedia',
    'linkedin.com': 'LinkedIn',
    'youtube.com': 'YouTube',
    'x.com': 'X',
  };
  if (known[domain]) return known[domain];
  const parts = domain.split('.');
  const part = (parts.length > 1 ? parts.at(-2) : parts[0])?.replace(/[-_]/g, ' ');
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : domain;
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatDetailedDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 10 && remainder >= 10) return `${minutes}m ${remainder}s`;
  return formatDuration(ms);
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

function previousRange(range: RangeKey, from: number, to: number): { from: number; to: number; label: string } {
  if (range === 'today') return { from: from - 24 * 60 * 60_000, to: to - 24 * 60 * 60_000, label: 'yesterday' };
  const duration = to - from;
  return { from: from - duration, to: from, label: range === 'hour' ? 'previous hour' : 'previous 3 hours' };
}

function trend(current: number, previous: number, label: string): string {
  if (previous < 1_000) return `No ${label} baseline`;
  const percent = Math.round((Math.abs(current - previous) / previous) * 100);
  if (percent < 3) return `About the same as ${label}`;
  return `${current > previous ? '↑' : '↓'} ${percent}% ${current > previous ? 'more' : 'less'} than ${label}`;
}

function placeTrend(current: number, previous: number, label: string): string {
  if (!previous) return `No ${label} baseline`;
  const difference = current - previous;
  if (!difference) return `Same as ${label}`;
  return `${difference > 0 ? '↑' : '↓'} ${Math.abs(difference)} ${difference > 0 ? 'more' : 'fewer'} than ${label}`;
}

function faviconUrl(domain: string, size = 32): string | undefined {
  if (!isChromeExtension()) return undefined;
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', `https://${domain}/`);
  url.searchParams.set('size', String(size));
  return url.toString();
}

function SiteFavicon({ domain, index = 0, featured = false }: { domain: string; index?: number; featured?: boolean }) {
  const name = domainName(domain);
  const source = faviconUrl(domain, featured ? 64 : 32);
  return (
    <span
      className={`mirror-favicon mirror-favicon-${(index % 5) + 1}${featured ? ' mirror-inline-favicon' : ''}`}
      role={featured ? 'img' : undefined}
      aria-label={featured ? name : undefined}
      title={featured ? name : undefined}
      aria-hidden={featured ? undefined : true}
    >
      <span aria-hidden="true">{name.charAt(0)}</span>
      {source && <img src={source} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
    </span>
  );
}

function timeBuckets(ledger: AttentionLedger | undefined, from: number, to: number, count = 14): number[] {
  const buckets = Array.from({ length: count }, () => 0);
  const width = Math.max(1, (to - from) / count);
  (ledger?.intervals ?? []).forEach((interval) => {
    const start = Math.max(from, interval.startedAt);
    const end = Math.min(to, interval.endedAt);
    if (end <= start) return;
    const first = Math.max(0, Math.floor((start - from) / width));
    const last = Math.min(count - 1, Math.floor((end - from - 1) / width));
    for (let index = first; index <= last; index += 1) {
      const bucketStart = from + index * width;
      const bucketEnd = bucketStart + width;
      buckets[index] += Math.max(0, Math.min(end, bucketEnd) - Math.max(start, bucketStart));
    }
  });
  return buckets;
}

function visitShape(ledger: AttentionLedger | undefined, from: number, to: number): { sustained: number; quick: number } {
  return (ledger?.intervals ?? []).reduce((shape, interval) => {
    const elapsed = Math.max(0, Math.min(to, interval.endedAt) - Math.max(from, interval.startedAt));
    if (elapsed >= 2 * 60_000) shape.sustained += elapsed;
    else if (elapsed > 0) shape.quick += elapsed;
    return shape;
  }, { sustained: 0, quick: 0 });
}

function ActivityChart({ buckets, previousAverage, from, to }: { buckets: number[]; previousAverage: number; from: number; to: number }) {
  const width = 260;
  const height = 112;
  const pad = 10;
  const max = Math.max(...buckets, previousAverage, 1);
  const points = buckets.map((value, index) => {
    const x = pad + (index / Math.max(1, buckets.length - 1)) * (width - pad * 2);
    const y = height - pad - (value / max) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const averageY = height - pad - (previousAverage / max) * (height - pad * 2);
  return (
    <div className="mirror-chart-card">
      <h3>Observed time</h3>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Observed browser time across the selected range">
        <line className="mirror-average-line" x1={pad} x2={width - pad} y1={averageY} y2={averageY} />
        <polyline className="mirror-time-line" points={points} />
        {buckets.map((value, index) => {
          const [x, y] = points.split(' ')[index].split(',');
          return <circle key={`${x}-${index}`} cx={x} cy={y} r={value ? 2.2 : 1.2} />;
        })}
      </svg>
      <div className="mirror-chart-axis"><span>{formatClock(from)}</span><span>{formatClock(from + (to - from) / 2)}</span><span>{formatClock(to)}</span></div>
      <div className="mirror-chart-legend"><span><i />Observed</span><span><i />Previous average</span></div>
    </div>
  );
}

function demoLedger(now: number): AttentionLedger {
  return {
    dateKey: new Date(now).toISOString().slice(0, 10),
    updatedAt: now,
    entries: [],
    intervals: [
      { domain: 'mail.google.com', title: 'Gmail', startedAt: now - 59 * 60_000, endedAt: now - 34 * 60_000 },
      { domain: 'chatgpt.com', title: 'ChatGPT', startedAt: now - 33 * 60_000, endedAt: now - 23 * 60_000 },
      { domain: 'youtube.com', title: 'YouTube', startedAt: now - 21 * 60_000, endedAt: now - 15 * 60_000 },
      { domain: 'en.wikipedia.org', title: 'Wikipedia', startedAt: now - 13 * 60_000, endedAt: now - 8 * 60_000 },
      { domain: 'linkedin.com', title: 'LinkedIn', startedAt: now - 7 * 60_000, endedAt: now - 3 * 60_000 },
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

  const from = rangeStart(range, now);
  const priorRange = previousRange(range, from, now);
  const summary = useMemo(() => summarizeAttention(ledger, from, now), [ledger, from, now]);
  const prior = useMemo(() => summarizeAttention(ledger, priorRange.from, priorRange.to), [ledger, priorRange.from, priorRange.to]);
  const buckets = useMemo(() => timeBuckets(ledger, from, now), [ledger, from, now]);
  const priorBuckets = useMemo(() => timeBuckets(ledger, priorRange.from, priorRange.to), [ledger, priorRange.from, priorRange.to]);
  const shape = useMemo(() => visitShape(ledger, from, now), [ledger, from, now]);
  const visible = summary.entries.slice(0, 10);
  const top = summary.entries[0];
  const second = summary.entries[1];
  const observedEnough = summary.totalMs >= 30_000 && Boolean(top);
  const selectedRange = RANGES.find((item) => item.key === range) ?? RANGES[0];
  const emptyPeriod = range === 'today' ? 'today' : range === 'hour' ? 'in the last hour' : 'in the last 3 hours';
  const placeCount = summary.entries.length;
  const priorAverage = priorBuckets.reduce((sum, value) => sum + value, 0) / Math.max(1, priorBuckets.length);
  const averagePerPlace = summary.totalMs / Math.max(1, placeCount);
  const priorAveragePerPlace = prior.totalMs / Math.max(1, prior.entries.length);
  const shapeTotal = shape.sustained + shape.quick;
  const sustainedPercent = shapeTotal ? Math.round((shape.sustained / shapeTotal) * 100) : 0;

  return (
    <main className="mirror-page">
      <section className="mirror-shell mirror-dashboard">
        <header className="mirror-heading">
          <div><strong>Where your browser time went</strong><span>Across focused Chrome windows</span></div>
          <div className="mirror-ranges" role="group" aria-label="Time range">
            {RANGES.map((item) => <button key={item.key} className={range === item.key ? 'selected' : ''} onClick={() => setRange(item.key)}>{item.label}</button>)}
          </div>
        </header>

        <div className="mirror-content-grid">
          <section className="mirror-main-column">
            <p className="mirror-kicker">Your browser, reflected</p>
            <h1 className="mirror-line">
              {observedEnough ? <>{formatDuration(summary.totalMs)} observed,<br />spread across {placeCount} {placeCount === 1 ? 'place' : 'places'}.</> : `Nothing observed ${emptyPeriod} yet.`}
            </h1>
            {observedEnough && <p className="mirror-top-sites">
              <span>Most time went to</span><SiteFavicon domain={top.domain} featured /><strong>{formatDetailedDuration(top.totalMs)}</strong>
              {second && <><span>then</span><SiteFavicon domain={second.domain} index={1} featured /><strong>{formatDetailedDuration(second.totalMs)}</strong></>}
            </p>}
            {observedEnough && summary.firstObservedAt !== undefined && summary.lastObservedAt !== undefined && <p className="mirror-span">
              Active between <strong>{formatClock(summary.firstObservedAt)}</strong> and <strong>{formatClock(summary.lastObservedAt)}</strong>
              <span> · {formatDuration(summary.totalMs)} total</span>
            </p>}

            {observedEnough && <section className="mirror-breakdown mirror-hour-chart" aria-label={`${selectedRange.label} attention breakdown`}>
              {visible.map((entry, index) => {
                const share = Math.round((entry.totalMs / summary.totalMs) * 1_000) / 10;
                return <div className="mirror-row" key={entry.domain}>
                  <SiteFavicon domain={entry.domain} index={index} />
                  <strong>{domainName(entry.domain)}</strong>
                  <div className="mirror-track"><i className={`mirror-fill mirror-fill-${(index % 5) + 1}`} style={{ width: `${Math.max(2, (entry.totalMs / top.totalMs) * 100)}%` }} /></div>
                  <span>{formatDetailedDuration(entry.totalMs)}</span>
                  <span>{share}%</span>
                </div>;
              })}
              {placeCount > visible.length && <div className="mirror-more-row"><span>{placeCount - visible.length} more places</span><span>{formatDetailedDuration(summary.entries.slice(visible.length).reduce((sum, entry) => sum + entry.totalMs, 0))}</span></div>}
            </section>}
            <p className="mirror-privacy">Observed active-tab time · stored on this device</p>
          </section>

          {observedEnough && <aside className="mirror-sidebar">
            <section className="mirror-stat-card">
              <div><Clock3 /><span><strong>{formatDetailedDuration(summary.totalMs)}</strong><small>Total observed time</small><em>{trend(summary.totalMs, prior.totalMs, priorRange.label)}</em></span></div>
              <div><Globe2 /><span><strong>{placeCount}</strong><small>Places visited</small><em>{placeTrend(placeCount, prior.entries.length, priorRange.label)}</em></span></div>
              <div><TimerReset /><span><strong>{formatDetailedDuration(averagePerPlace)}</strong><small>Average time per place</small><em>{trend(averagePerPlace, priorAveragePerPlace, priorRange.label)}</em></span></div>
            </section>
            <ActivityChart buckets={buckets} previousAverage={priorAverage} from={from} to={now} />
            <section className="mirror-shape-card">
              <h3>Visit shape</h3>
              <div className="mirror-shape-content">
                <div className="mirror-donut" style={{ background: `conic-gradient(var(--chrome-blue) 0 ${sustainedPercent}%, #f28b82 ${sustainedPercent}% 100%)` }}><span><strong>{sustainedPercent}%</strong><small>sustained</small></span></div>
                <div className="mirror-shape-legend">
                  <span><i />Sustained visits<strong>{formatDetailedDuration(shape.sustained)}</strong><small>2 min or longer</small></span>
                  <span><i />Quick checks<strong>{formatDetailedDuration(shape.quick)}</strong><small>Under 2 min</small></span>
                </div>
              </div>
            </section>
          </aside>}
        </div>
      </section>
    </main>
  );
}
