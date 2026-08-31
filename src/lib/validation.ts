import { z } from 'zod';

const evidenceIds = z.array(z.string()).max(100);

export const analysisSchema = z.object({
  version: z.literal(1).default(1),
  generatedAt: z.number().default(() => Date.now()),
  provider: z.enum(['mock', 'local', 'llm']).default('llm'),
  summary: z.string().min(1).max(500),
  diagnosis: z.string().min(1).max(500),
  missions: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(300),
    tabCount: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    status: z.enum(['active', 'drifting', 'stale', 'unresolved']),
    representativeTabs: z.array(z.object({
      tabId: z.string(),
      title: z.string(),
      domain: z.string(),
    })).max(6),
    evidenceTabIds: evidenceIds.min(1),
    signals: z.array(z.string()).max(8),
    nextAction: z.string().max(240).optional(),
  })).min(1).max(7),
  obsessions: z.array(z.object({
    id: z.string(),
    label: z.string().min(1).max(100),
    description: z.string().min(1).max(240),
    tabCount: z.number().int().nonnegative(),
    share: z.number().min(0).max(1),
    evidenceTabIds: evidenceIds.min(1),
    domains: z.array(z.string()).max(12),
  })).max(5),
  momentum: z.array(z.object({
    label: z.string().min(1).max(100),
    kind: z.enum(['heating', 'dominating', 'cooling']),
    detail: z.string().min(1).max(240),
    evidenceTabIds: evidenceIds.min(1),
  })).max(6),
  openLoops: z.array(z.object({
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(300),
    confidence: z.number().min(0).max(1),
    evidenceTabIds: evidenceIds.min(1),
  })).max(6),
  cleanup: z.array(z.object({
    tabId: z.string(),
    classification: z.enum(['essential', 'supporting', 'redundant', 'stale', 'unknown']),
    reason: z.string().min(1).max(240),
  })).max(600),
  surprisingObservations: z.array(z.object({
    text: z.string().min(1).max(360),
    confidence: z.number().min(0).max(1),
    evidenceTabIds: evidenceIds.min(1),
  })).max(6),
});

export type ValidatedAnalysis = z.infer<typeof analysisSchema>;

export function parseAnalysisResponse(value: unknown): ValidatedAnalysis {
  return analysisSchema.parse(value);
}
