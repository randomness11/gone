const baseUrl = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1';
const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.LLM_MODEL || 'inclusionai/ling-3.0-flash-fin:free';

if (!apiKey) throw new Error('OPENROUTER_API_KEY is missing from .env');

const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 256,
    provider: { data_collection: 'deny' },
    reasoning: { effort: 'none', exclude: true },
    tools: [{
      type: 'function',
      function: {
        name: 'tabscope_ready',
        description: 'Report that Tabscope is ready.',
        parameters: {
          type: 'object',
          properties: { tabscope: { type: 'string', enum: ['ready'] } },
          required: ['tabscope'],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: 'function', function: { name: 'tabscope_ready' } },
    messages: [
      { role: 'system', content: 'Return only valid JSON.' },
      { role: 'user', content: 'Return {"tabscope":"ready"} and nothing else.' },
    ],
  }),
});

const payload = await response.json();
if (!response.ok) {
  const message = payload?.error?.message || `HTTP ${response.status}`;
  throw new Error(`OpenRouter smoke test failed: ${message}`);
}

const message = payload?.choices?.[0]?.message;
const nativeContent = message?.content;
const nativeMatch = typeof nativeContent === 'string'
  ? nativeContent.match(/<arg_key>tabscope<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/i)
  : undefined;
const content = message?.tool_calls?.[0]?.function?.arguments
  || (nativeMatch ? JSON.stringify({ tabscope: nativeMatch[1].trim() }) : nativeContent);
let validJson = false;
try {
  validJson = JSON.parse(content)?.tabscope === 'ready';
} catch {
  validJson = false;
}

console.log(JSON.stringify({
  ok: true,
  model: payload.model || model,
  validJson,
  finishReason: payload?.choices?.[0]?.finish_reason,
  outputTokens: payload?.usage?.completion_tokens,
  invalidSample: validJson ? undefined : String(content).slice(0, 200),
  invalidChoice: validJson ? undefined : payload?.choices?.[0],
}));
