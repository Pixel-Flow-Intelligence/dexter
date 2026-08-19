import type { HeadlessRunRequest } from '../headless/types.js';

export interface ResearchOutputTemplate {
  templateKey?: string;
  title?: string;
  contentMarkdown?: string;
  sections?: Array<{
    key?: string;
    title?: string;
    purpose?: string;
    required?: boolean;
  }>;
}

export interface ResearchRequestBody {
  query: string;
  runId?: string;
  sessionId?: string;
  model?: string;
  maxIterations?: number;
  memoryEnabled?: boolean;
  outputTemplate?: ResearchOutputTemplate;
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
  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  return {
    runId: typeof body.runId === 'string' && body.runId.trim() ? body.runId : crypto.randomUUID(),
    sessionId: typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId : 'http-local',
    query: body.query,
    // 请求带了模型名就原样使用；空值才回退 Dexter 自己的环境默认。
    model: requestedModel || process.env.DEXTER_MODEL || 'gpt-5.6-sol',
    // Provider / 密钥只看 Dexter 本机配置，忽略调用方传入的 provider。
    modelProvider: process.env.DEXTER_MODEL_PROVIDER || 'openai',
    maxIterations: body.maxIterations,
    memoryEnabled: body.memoryEnabled ?? true,
    outputTemplate: parseOutputTemplate(body.outputTemplate),
  };
}

function parseOutputTemplate(value: unknown): HeadlessRunRequest['outputTemplate'] {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as ResearchOutputTemplate;
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          key: typeof item.key === 'string' ? item.key : '',
          title: typeof item.title === 'string' ? item.title : '',
          purpose: typeof item.purpose === 'string' ? item.purpose : '',
          required: Boolean(item.required),
        }))
        .filter((item) => item.title.trim())
    : [];
  const contentMarkdown = typeof raw.contentMarkdown === 'string' ? raw.contentMarkdown.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const templateKey = typeof raw.templateKey === 'string' ? raw.templateKey.trim() : '';
  if (!templateKey && !title && !contentMarkdown && sections.length === 0) return undefined;
  return { templateKey, title, contentMarkdown, sections };
}
