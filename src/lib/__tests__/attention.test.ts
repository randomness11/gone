import { describe, expect, it } from 'vitest';
import { attentionTotalMs, emptyAttentionLedger, summarizeAttention, transitionAttention } from '../attention';

const sample = { tabId: 1, windowId: 1, domain: 'x.com', title: 'X' };

describe('local active-tab attention', () => {
  it('credits elapsed time when attention moves away', () => {
    const started = transitionAttention(emptyAttentionLedger(1_000), sample, 1_000);
    const finished = transitionAttention(started, undefined, 61_000);
    expect(finished.entries[0]).toMatchObject({ domain: 'x.com', totalMs: 60_000, activations: 1 });
    expect(finished.intervals[0]).toMatchObject({ domain: 'x.com', startedAt: 1_000, endedAt: 61_000 });
  });

  it('computes truthful rolling windows from timestamped intervals', () => {
    const first = transitionAttention(undefined, sample, 1_000);
    const switched = transitionAttention(first, { ...sample, tabId: 2, domain: 'chatgpt.com', title: 'ChatGPT' }, 61_000);
    const finished = transitionAttention(switched, undefined, 181_000);

    const lastTwoMinutes = summarizeAttention(finished, 61_000, 181_000);
    expect(lastTwoMinutes.totalMs).toBe(120_000);
    expect(lastTwoMinutes.firstObservedAt).toBe(61_000);
    expect(lastTwoMinutes.lastObservedAt).toBe(181_000);
    expect(lastTwoMinutes.entries).toHaveLength(1);
    expect(lastTwoMinutes.entries[0].domain).toBe('chatgpt.com');

    const wholeRange = summarizeAttention(finished, 1_000, 181_000);
    expect(wholeRange.entries.map((entry) => entry.domain)).toEqual(['chatgpt.com', 'x.com']);
  });

  it('checkpoints the same active tab without inventing another activation', () => {
    const started = transitionAttention(undefined, sample, 1_000);
    const checkpoint = transitionAttention(started, sample, 61_000);
    expect(checkpoint.entries[0]).toMatchObject({ totalMs: 60_000, activations: 1 });
    expect(attentionTotalMs(checkpoint)).toBe(60_000);
  });

  it('does not credit an unbounded suspended-worker gap', () => {
    const started = transitionAttention(undefined, sample, 1_000);
    const finished = transitionAttention(started, undefined, 61 * 60_000);
    expect(finished.entries[0].totalMs).toBe(5 * 60_000);
  });
});
