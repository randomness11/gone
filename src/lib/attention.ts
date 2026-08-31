import type { ActiveAttentionSample, AttentionEntry, AttentionInterval, AttentionLedger } from '../types';

const MAX_UNCHECKED_SEGMENT_MS = 5 * 60_000;
const RETENTION_MS = 8 * 24 * 60 * 60_000;

export function attentionDateKey(now = Date.now()): string {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function emptyAttentionLedger(now = Date.now()): AttentionLedger {
  return { dateKey: attentionDateKey(now), updatedAt: now, entries: [], intervals: [] };
}

function addElapsed(
  entries: AttentionEntry[],
  intervals: AttentionInterval[],
  active: ActiveAttentionSample,
  now: number,
): { entries: AttentionEntry[]; intervals: AttentionInterval[] } {
  const elapsed = Math.max(0, Math.min(now - active.startedAt, MAX_UNCHECKED_SEGMENT_MS));
  if (elapsed < 1_000) return { entries, intervals };
  const startedAt = now - elapsed;
  const existing = entries.find((entry) => entry.domain === active.domain);
  const nextEntries = !existing ? [...entries, {
      domain: active.domain,
      title: active.title,
      totalMs: elapsed,
      activations: 1,
      lastSeenAt: now,
    }] : entries.map((entry) => entry.domain === active.domain ? {
    ...entry,
    title: active.title || entry.title,
    totalMs: entry.totalMs + elapsed,
    lastSeenAt: now,
  } : entry);

  const recentIntervals = intervals.filter((interval) => interval.endedAt >= now - RETENTION_MS);
  const last = recentIntervals.at(-1);
  const nextIntervals = last && last.domain === active.domain && last.endedAt >= startedAt - 1_000
    ? [...recentIntervals.slice(0, -1), { ...last, title: active.title || last.title, endedAt: now }]
    : [...recentIntervals, { domain: active.domain, title: active.title, startedAt, endedAt: now }];
  return { entries: nextEntries, intervals: nextIntervals.slice(-2_500) };
}

export function transitionAttention(
  ledger: AttentionLedger | undefined,
  next: Omit<ActiveAttentionSample, 'startedAt'> | undefined,
  now = Date.now(),
): AttentionLedger {
  const sameDay = ledger?.dateKey === attentionDateKey(now);
  const current: AttentionLedger = ledger && sameDay ? { ...ledger, intervals: ledger.intervals ?? [] } : {
    ...emptyAttentionLedger(now),
    intervals: (ledger?.intervals ?? []).filter((interval) => interval.endedAt >= now - RETENTION_MS),
  };
  const elapsed = current.active
    ? addElapsed(current.entries, current.intervals ?? [], current.active, now)
    : { entries: current.entries, intervals: current.intervals ?? [] };
  const entries = elapsed.entries;
  const sameTab = Boolean(next && current.active && next.tabId === current.active.tabId);
  const withActivation = next && !sameTab
    ? entries.map((entry) => entry.domain === next.domain ? { ...entry, activations: entry.activations + 1 } : entry)
    : entries;
  const hasEntry = next && withActivation.some((entry) => entry.domain === next.domain);
  const nextEntries = next && !hasEntry ? [...withActivation, {
    domain: next.domain,
    title: next.title,
    totalMs: 0,
    activations: 1,
    lastSeenAt: now,
  }] : withActivation;

  return {
    dateKey: attentionDateKey(now),
    updatedAt: now,
    entries: nextEntries
      .filter((entry) => entry.totalMs > 0 || next?.domain === entry.domain)
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 24),
    intervals: elapsed.intervals,
    active: next ? { ...next, startedAt: now } : undefined,
  };
}

export function attentionTotalMs(ledger?: AttentionLedger): number {
  return ledger?.entries.reduce((sum, entry) => sum + entry.totalMs, 0) ?? 0;
}

export interface AttentionRangeSummary {
  from: number;
  to: number;
  totalMs: number;
  switchCount: number;
  entries: AttentionEntry[];
}

export function summarizeAttention(ledger: AttentionLedger | undefined, from: number, to: number): AttentionRangeSummary {
  const grouped = new Map<string, AttentionEntry>();
  const matching = (ledger?.intervals ?? []).filter((interval) => interval.endedAt > from && interval.startedAt < to);
  matching.forEach((interval) => {
    const elapsed = Math.max(0, Math.min(interval.endedAt, to) - Math.max(interval.startedAt, from));
    if (!elapsed) return;
    const existing = grouped.get(interval.domain);
    grouped.set(interval.domain, existing ? {
      ...existing,
      title: interval.title || existing.title,
      totalMs: existing.totalMs + elapsed,
      activations: existing.activations + 1,
      lastSeenAt: Math.max(existing.lastSeenAt, interval.endedAt),
    } : {
      domain: interval.domain,
      title: interval.title,
      totalMs: elapsed,
      activations: 1,
      lastSeenAt: interval.endedAt,
    });
  });
  const entries = [...grouped.values()].sort((a, b) => b.totalMs - a.totalMs);
  return {
    from,
    to,
    totalMs: entries.reduce((sum, entry) => sum + entry.totalMs, 0),
    switchCount: Math.max(0, matching.length - 1),
    entries,
  };
}
