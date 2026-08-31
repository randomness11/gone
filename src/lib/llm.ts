import type { AnalysisResult, AttentionLedger, PreprocessedTabs, ReflectionFeedback } from '../types';
import { compactTabsForModel } from './preprocessing';
import { parseAnalysisResponse } from './validation';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const ANALYSIS_SYSTEM_PROMPT = `You are the browser conscience inside GONE. You appear for one moment when the user opens a new tab.

Your job is to notice the single most timely, concrete thing in the user's observed active-tab time and open tabs: where attention actually went, what keeps pulling them back, and what unfinished decision may still be underneath it. Do not produce a dashboard in prose. Create one small moment of recognition, then preserve structured missions and evidence for the product.

Rules:
- Write like a perceptive, slightly cheeky friend—not an analyst, therapist, productivity coach, or judge.
- Describe this moment, never the person's identity. Use provisional language such as "seems," "might," and "may" whenever intent is inferred.
- Make the user feel specifically seen without making them feel watched. Warmth and restraint matter more than cleverness.
- Avoid loaded words in user-facing copy: obsessed, scattered, distracted, cluttered, dead, low-value, failing, procrastinating, or uncomfortable.
- diagnosis is the large new-tab headline. Keep it under 12 words. When attention evidence exists, name the concrete domain or behavior. It should feel like a timely nudge, not a report.
- summary is the one-sentence evidence underneath the headline. Use exact observed minutes, revisits, tab counts, or named sources when supplied. Never call observed time productive, wasted, focused, or distracted.
- nextAction should help the user return to, intentionally leave, or resolve a thread. Do not scold, command, or prescribe.
- When user corrections are supplied, treat them as authoritative. Do not revive a finished/not-now mission as the primary mission unless strong new evidence appears.
- Every major inference must be defensible from the provided tab IDs or aggregated attention domains. Never invent activity, history, identity, or motivation.
- Observed active-tab minutes are local measurements, not proof of continuous reading or intent. Say "observed browser time" when precision matters.
- Prefer specific quantities and named entities when supported.
- Avoid vague horoscope language such as "exploring various topics," "interested in technology," or "you appear curious."
- Infer 2–7 missions when evidence allows. Use fewer for small inputs.
- lastAccessed and ageHours are weak momentum signals, not proof of when a tab was created.
- Classify every supplied tab exactly once in cleanup: essential, supporting, redundant, stale, or unknown.
- A tab should be stale only when weak recency and weak mission relevance support it. Pinned or active tabs should usually be essential.
- Do not recommend closing tabs automatically.
- Return JSON only, matching the requested shape. Confidence is 0–1; share is 0–1.
- When a submit_tabscope_analysis tool is available, call it exactly once with the complete result.

JSON shape:
{
  "version": 1,
  "generatedAt": 0,
  "provider": "llm",
  "summary": "...",
  "diagnosis": "one warm, specific reflection",
  "missions": [{"id":"...","title":"...","description":"...","tabCount":0,"confidence":0.0,"status":"active|drifting|stale|unresolved","representativeTabs":[{"tabId":"...","title":"...","domain":"..."}],"evidenceTabIds":["..."],"signals":["..."],"nextAction":"optional"}],
  "obsessions": [{"id":"...","label":"...","description":"...","tabCount":0,"share":0.0,"evidenceTabIds":["..."],"domains":["..."]}],
  "momentum": [{"label":"...","kind":"heating|dominating|cooling","detail":"...","evidenceTabIds":["..."]}],
  "openLoops": [{"title":"...","description":"...","confidence":0.0,"evidenceTabIds":["..."]}],
  "cleanup": [{"tabId":"...","classification":"essential|supporting|redundant|stale|unknown","reason":"..."}],
  "surprisingObservations": [{"text":"...","confidence":0.0,"evidenceTabIds":["..."]}]
}`;

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

type CompletionMessage = { role: 'system' | 'user'; content: string };
export const MODEL_ANALYSIS_TIMEOUT_MS = 7_000;

export function buildCompletionBody(config: LlmConfig, messages: CompletionMessage[]) {
  const isOpenRouter = new URL(config.baseUrl).hostname === 'openrouter.ai';
  const isLingFlashFin = config.model.startsWith('inclusionai/ling-3.0-flash-fin');
  const supportsResponseFormat = !isLingFlashFin;
  return {
    model: config.model,
    temperature: 0.25,
    max_tokens: 8_000,
    messages,
    ...(supportsResponseFormat ? { response_format: { type: 'json_object' as const } } : {}),
    ...(isOpenRouter ? { provider: { data_collection: 'deny' as const } } : {}),
    ...(isOpenRouter && isLingFlashFin ? { reasoning: { effort: 'none' as const, exclude: true } } : {}),
    ...(isLingFlashFin ? {
      tools: [{
        type: 'function' as const,
        function: {
          name: 'submit_tabscope_analysis',
          description: 'Submit the complete GONE analysis as one JSON object.',
          parameters: {
            type: 'object' as const,
            properties: {
              version: { type: 'number' },
              generatedAt: { type: 'number' },
              provider: { type: 'string' },
              summary: { type: 'string' },
              diagnosis: { type: 'string' },
              missions: { type: 'array', items: { type: 'object', additionalProperties: true } },
              obsessions: { type: 'array', items: { type: 'object', additionalProperties: true } },
              momentum: { type: 'array', items: { type: 'object', additionalProperties: true } },
              openLoops: { type: 'array', items: { type: 'object', additionalProperties: true } },
              cleanup: { type: 'array', items: { type: 'object', additionalProperties: true } },
              surprisingObservations: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
            required: ['version', 'generatedAt', 'provider', 'summary', 'diagnosis', 'missions', 'obsessions', 'momentum', 'openLoops', 'cleanup', 'surprisingObservations'],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: 'function' as const, function: { name: 'submit_tabscope_analysis' } },
    } : {}),
  };
}

export function parseLingToolCall(content: string): string | undefined {
  const call = content.match(/<tool_call>\s*([^\s<]+)([\s\S]*?)<\/tool_call>/i);
  if (!call || call[1] !== 'submit_tabscope_analysis') return undefined;

  const result: Record<string, unknown> = {};
  const argumentPattern = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
  let match: RegExpExecArray | null;
  while ((match = argumentPattern.exec(call[2])) !== null) {
    const key = match[1].trim();
    const rawValue = match[2].trim();
    try {
      result[key] = JSON.parse(rawValue);
    } catch {
      result[key] = rawValue;
    }
  }
  return Object.keys(result).length ? JSON.stringify(result) : undefined;
}

async function requestCompletion(config: LlmConfig, messages: CompletionMessage[], deadline: number): Promise<string> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
  let response: Response;
  try {
    response = await fetch(endpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildCompletionBody(config, messages)),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new Error('The model took too long, so GONE kept the fast on-device reflection.');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) throw new Error('The model provider is rate limiting requests. Wait a moment and try again.');
    throw new Error(`Model request failed (${response.status}): ${body.slice(0, 180)}`);
  }
  const payload = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { arguments?: string } }>;
      };
    }>;
  };
  const message = payload.choices?.[0]?.message;
  const toolArguments = message?.tool_calls?.[0]?.function?.arguments;
  const content = toolArguments || (message?.content && config.model.startsWith('inclusionai/ling-3.0-flash-fin')
    ? parseLingToolCall(message.content)
    : message?.content);
  if (!content) throw new Error('The model provider returned an empty response.');
  return content;
}

function extractJson(raw: string): unknown {
  const withoutFences = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(withoutFences);
}

export function validateAnalysisAgainstSnapshot(analysis: AnalysisResult, data: PreprocessedTabs): AnalysisResult {
  const known = new Map(data.tabs.map((tab) => [tab.id, tab]));
  const assertKnown = (ids: string[], context: string) => {
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`${context} referenced unknown tab IDs: ${unknown.join(', ')}`);
  };

  analysis.missions.forEach((mission) => {
    assertKnown(mission.evidenceTabIds, `Mission ${mission.id}`);
    if (new Set(mission.evidenceTabIds).size !== mission.tabCount) {
      throw new Error(`Mission ${mission.id} tabCount must equal its unique evidenceTabIds count.`);
    }
    assertKnown(mission.representativeTabs.map((tab) => tab.tabId), `Mission ${mission.id} representatives`);
  });
  analysis.obsessions.forEach((item) => assertKnown(item.evidenceTabIds, `Obsession ${item.id}`));
  analysis.momentum.forEach((item) => assertKnown(item.evidenceTabIds, `Momentum ${item.label}`));
  analysis.openLoops.forEach((item) => assertKnown(item.evidenceTabIds, `Open loop ${item.title}`));
  analysis.surprisingObservations.forEach((item) => assertKnown(item.evidenceTabIds, 'Observation'));

  const cleanupIds = analysis.cleanup.map((item) => item.tabId);
  assertKnown(cleanupIds, 'Cleanup');
  if (cleanupIds.length !== known.size || new Set(cleanupIds).size !== known.size) {
    throw new Error('Cleanup must classify every supplied tab exactly once.');
  }

  return {
    ...analysis,
    missions: analysis.missions.map((mission) => ({
      ...mission,
      representativeTabs: mission.representativeTabs.map((reference) => {
        const source = known.get(reference.tabId)!;
        return { tabId: source.id, title: source.title, domain: source.domain };
      }),
    })),
  };
}

export async function analyzeWithLlm(data: PreprocessedTabs, config: LlmConfig, feedback: ReflectionFeedback[] = [], attention?: AttentionLedger): Promise<AnalysisResult> {
  const compact = JSON.stringify(compactTabsForModel(data));
  const compactAttention = attention ? JSON.stringify({
    observedMinutes: Math.round(attention.entries.reduce((sum, entry) => sum + entry.totalMs, 0) / 60_000),
    domains: attention.entries.filter((entry) => entry.totalMs >= 30_000).slice(0, 8).map((entry) => ({
      domain: entry.domain,
      observedMinutes: Math.round(entry.totalMs / 60_000),
      revisits: entry.activations,
      lastSeenMinutesAgo: Math.max(0, Math.round((Date.now() - entry.lastSeenAt) / 60_000)),
    })),
  }) : undefined;
  const corrections = feedback.slice(-12).map(({ kind, missionTitle }) => ({ kind, missionTitle }));
  const messages = [
    { role: 'system' as const, content: ANALYSIS_SYSTEM_PROMPT },
    { role: 'user' as const, content: `Analyze this sanitized current-tab snapshot. No page content or query parameters are included.\n${compact}${compactAttention ? `\nLocally observed active-tab time today (aggregated before sending):\n${compactAttention}` : ''}${corrections.length ? `\nUser corrections from earlier reflections (honor these unless the new evidence clearly changed):\n${JSON.stringify(corrections)}` : ''}` },
  ];

  const deadline = Date.now() + MODEL_ANALYSIS_TIMEOUT_MS;
  let raw = await requestCompletion(config, messages, deadline);
  try {
    const parsed = parseAnalysisResponse(extractJson(raw));
    return validateAnalysisAgainstSnapshot({ ...parsed, generatedAt: Date.now(), provider: 'llm' }, data);
  } catch (firstError) {
    raw = await requestCompletion(config, [
      ...messages,
      { role: 'user', content: `Your previous JSON was malformed or failed schema validation. Repair it and return only complete valid JSON. Previous response:\n${raw.slice(0, 12_000)}\nValidation hint: ${firstError instanceof Error ? firstError.message.slice(0, 500) : 'invalid JSON'}` },
    ], deadline);
    const parsed = parseAnalysisResponse(extractJson(raw));
    return validateAnalysisAgainstSnapshot({ ...parsed, generatedAt: Date.now(), provider: 'llm' }, data);
  }
}
