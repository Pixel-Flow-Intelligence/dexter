import type { HeadlessRunRequest } from '../headless/types.js';

export interface ResearchRequestBody {
  query: string;
  runId?: string;
  sessionId?: string;
  model?: string;
  modelProvider?: string;
  maxIterations?: number;
  memoryEnabled?: boolean;
}

export function parseResearchRequest(value: unknown): Omit<HeadlessRunRequest, 'signal'> {
  if (!value || typeof value !== 'object') {
    throw new Error('request body must be a JSON object');
  }
  const body = value as Partial<ResearchRequestBody>;
  if (body.query === undefined) throw new Error('query is required');
  if (typeof body.query !== 'string') throw new Error('query must be a string');
  if (!body.query.trim()) throw new Error('query is required');
  if (body.maxIterations !== undefined && (!Number.isInteger(body.maxIterations) || body.maxIterations < 1 || body.maxIterations > 50)) {
    throw new Error('maxIterations must be an integer between 1 and 50');
  }
  return {
    runId: typeof body.runId === 'string' && body.runId.trim() ? body.runId : crypto.randomUUID(),
    sessionId: typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId : 'http-local',
    query: body.query,
    model: typeof body.model === 'string' && body.model.trim() ? body.model : process.env.DEXTER_MODEL ?? 'gpt-5.6-sol',
    modelProvider: typeof body.modelProvider === 'string' && body.modelProvider.trim() ? body.modelProvider : process.env.DEXTER_MODEL_PROVIDER ?? 'openai',
    maxIterations: body.maxIterations,
    memoryEnabled: body.memoryEnabled ?? true,
  };
}
