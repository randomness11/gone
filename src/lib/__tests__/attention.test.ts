import { describe, expect, it } from 'vitest';
import { attentionTotalMs, emptyAttentionLedger, transitionAttention } from '../attention';

const sample = { tabId: 1, windowId: 1, domain: 'x.com', title: 'X' };

describe('local active-tab attention', () => {
  it('credits elapsed time when attention moves away', () => {
    const started = transitionAttention(emptyAttentionLedger(1_000), sample, 1_000);
    const finished = transitionAttention(started, undefined, 61_000);
    expect(finished.entries[0]).toMatchObject({ domain: 'x.com', totalMs: 60_000, activations: 1 });
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
