import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeWithLlm, buildCompletionBody, MODEL_ANALYSIS_TIMEOUT_MS, parseLingToolCall } from '../llm';
import { preprocessTabs } from '../preprocessing';

const messages = [
  { role: 'system' as const, content: 'Return JSON only.' },
  { role: 'user' as const, content: 'Analyze these tabs.' },
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OpenRouter request compatibility', () => {
  it('omits response_format for Ling 3.0 Flash Fin and denies data collection', () => {
    const body = buildCompletionBody({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test-only',
      model: 'inclusionai/ling-3.0-flash-fin:free',
    }, messages);
    expect(body).not.toHaveProperty('response_format');
    expect(body.provider).toEqual({ data_collection: 'deny' });
    expect(body.reasoning).toEqual({ effort: 'none', exclude: true });
    expect(body.tools?.[0].function.name).toBe('submit_tabscope_analysis');
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'submit_tabscope_analysis' } });
    expect(body.max_tokens).toBe(8_000);
  });

  it('retains JSON mode for providers and models that support it', () => {
    const body = buildCompletionBody({
      baseUrl: 'https://example-model-host.test/v1',
      apiKey: 'test-only',
      model: 'structured-model',
    }, messages);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('tools');
  });

  it('normalizes Ling native XML tool arguments into JSON', () => {
    const native = `<tool_call>submit_tabscope_analysis
<arg_key>version</arg_key><arg_value>1</arg_value>
<arg_key>summary</arg_key><arg_value>Two missions are competing.</arg_value>
<arg_key>missions</arg_key><arg_value>[{"id":"m1","tabCount":4}]</arg_value>
</tool_call>`;
    expect(JSON.parse(parseLingToolCall(native)!)).toEqual({
      version: 1,
      summary: 'Two missions are competing.',
      missions: [{ id: 'm1', tabCount: 4 }],
    });
  });

  it('ignores unrelated or malformed Ling tool envelopes', () => {
    expect(parseLingToolCall('<tool_call>other_tool</tool_call>')).toBeUndefined();
    expect(parseLingToolCall('plain text')).toBeUndefined();
  });

  it('abandons a slow model pass after the product deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const data = preprocessTabs([
      { title: 'Tabscope implementation', url: 'https://example.com/tabscope', windowId: 1 },
    ], 1_000);
    const result = expect(analyzeWithLlm(data, {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test-only',
      model: 'inclusionai/ling-3.0-flash-fin:free',
    })).rejects.toThrow('kept the fast on-device reflection');

    await vi.advanceTimersByTimeAsync(MODEL_ANALYSIS_TIMEOUT_MS + 1);
    await result;
  });
});
