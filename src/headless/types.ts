import type { Agent, AgentConfig, AgentEvent } from '../agent/index.js';
import type { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';

export interface HeadlessOutputTemplate {
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

export interface HeadlessRunRequest {
  runId: string;
  sessionId: string;
  query: string;
  model: string;
  modelProvider: string;
  maxIterations?: number;
  memoryEnabled?: boolean;
  signal?: AbortSignal;
  metadata?: Record<string, string>;
  outputTemplate?: HeadlessOutputTemplate;
  systemPromptAppendix?: string;
}

export interface HeadlessAcceptedEvent {
  type: 'accepted';
  runId: string;
  sequence: number;
  occurredAt: string;
}

export interface HeadlessProgressEvent {
  type: 'thinking' | 'tool_start' | 'tool_end' | 'tool_error' | 'progress';
  runId: string;
  sequence: number;
  occurredAt: string;
  message?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
}

export interface HeadlessReportEvent {
  type: 'report';
  runId: string;
  sequence: number;
  occurredAt: string;
  answer: string;
}

export interface HeadlessTerminalEvent {
  type: 'completed' | 'failed' | 'cancelled';
  runId: string;
  sequence: number;
  occurredAt: string;
  answer?: string;
  error?: string;
}

export type HeadlessEvent =
  | HeadlessAcceptedEvent
  | HeadlessProgressEvent
  | HeadlessReportEvent
  | HeadlessTerminalEvent;

export type HeadlessEventInput =
  | { type: 'accepted' }
  | Omit<HeadlessProgressEvent, 'runId' | 'sequence' | 'occurredAt'>
  | Omit<HeadlessReportEvent, 'runId' | 'sequence' | 'occurredAt'>
  | Omit<HeadlessTerminalEvent, 'runId' | 'sequence' | 'occurredAt'>;

export interface HeadlessAgentLike {
  run(query: string, history?: InMemoryChatHistory): AsyncGenerator<AgentEvent>;
}

export type HeadlessAgentFactory = (config: AgentConfig) => Promise<HeadlessAgentLike>;

export interface HeadlessRunnerOptions {
  createAgent?: HeadlessAgentFactory;
  maxConcurrentRuns?: number;
}

export type { Agent };
