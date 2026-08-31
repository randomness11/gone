import type { AnalysisResult, AttentionLedger, PreprocessedTabs, ReflectionFeedback } from '../types';
import { analyzeWithLlm, type LlmConfig } from './llm';
import { buildLocalAnalysis } from './localAnalysis';

export function getBuildLlmConfig(): LlmConfig | undefined {
  const baseUrl = import.meta.env.LLM_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
  const apiKey = import.meta.env.LLM_API_KEY?.trim();
  const model = import.meta.env.LLM_MODEL?.trim() || 'inclusionai/ling-3.0-flash-fin:free';
  if (!apiKey) return undefined;
  return { baseUrl, apiKey, model };
}

export async function analyzeTabs(data: PreprocessedTabs, forceMock = false, feedback: ReflectionFeedback[] = [], attention?: AttentionLedger): Promise<AnalysisResult> {
  if (forceMock || import.meta.env.VITE_USE_MOCK_ANALYSIS === 'true') {
    return buildLocalAnalysis(data, 'mock');
  }
  const config = getBuildLlmConfig();
  if (!config) return buildLocalAnalysis(data, 'local');
  return analyzeWithLlm(data, config, feedback, attention);
}
