import type { ActiveAttentionSample, AttentionEntry, AttentionLedger } from '../types';

const MAX_UNCHECKED_SEGMENT_MS = 5 * 60_000;

export function attentionDateKey(now = Date.now()): string {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function emptyAttentionLedger(now = Date.now()): AttentionLedger {
  return { dateKey: attentionDateKey(now), updatedAt: now, entries: [] };
}

function addElapsed(entries: AttentionEntry[], active: ActiveAttentionSample, now: number): AttentionEntry[] {
  const elapsed = Math.max(0, Math.min(now - active.startedAt, MAX_UNCHECKED_SEGMENT_MS));
  if (elapsed < 1_000) return entries;
  const existing = entries.find((entry) => entry.domain === active.domain);
  if (!existing) {
    return [...entries, {
      domain: active.domain,
      title: active.title,
      totalMs: elapsed,
      activations: 1,
      lastSeenAt: now,
    }];
  }
  return entries.map((entry) => entry.domain === active.domain ? {
    ...entry,
    title: active.title || entry.title,
    totalMs: entry.totalMs + elapsed,
    lastSeenAt: now,
  } : entry);
}

export function transitionAttention(
  ledger: AttentionLedger | undefined,
  next: Omit<ActiveAttentionSample, 'startedAt'> | undefined,
  now = Date.now(),
): AttentionLedger {
  const current = ledger?.dateKey === attentionDateKey(now) ? ledger : emptyAttentionLedger(now);
  const entries = current.active ? addElapsed(current.entries, current.active, now) : current.entries;
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
    active: next ? { ...next, startedAt: now } : undefined,
  };
}

export function attentionTotalMs(ledger?: AttentionLedger): number {
  return ledger?.entries.reduce((sum, entry) => sum + entry.totalMs, 0) ?? 0;
}
