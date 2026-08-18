import { Agent } from '../agent/index.js';
import type { AgentConfig, AgentEvent } from '../agent/types.js';
import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';
import type {
  HeadlessAgentFactory,
  HeadlessEvent,
  HeadlessRunRequest,
  HeadlessRunnerOptions,
} from './types.js';

export class HeadlessRunner {
  private readonly createAgent: HeadlessAgentFactory;
  private readonly maxConcurrentRuns: number;
  private readonly activeRuns = new Set<string>();
  private readonly histories = new Map<string, InMemoryChatHistory>();

  constructor(options: HeadlessRunnerOptions = {}) {
    this.createAgent = options.createAgent ?? ((config) => Agent.create(config));
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? 4;
  }

  async *run(request: HeadlessRunRequest): AsyncGenerator<HeadlessEvent> {
    if (this.activeRuns.has(request.runId)) {
      yield* this.singleEvent(request, 'failed', { error: 'run_id is already active' });
      return;
    }
    if (this.activeRuns.size >= this.maxConcurrentRuns) {
      yield* this.singleEvent(request, 'failed', { error: 'maximum concurrent runs reached' });
      return;
    }

    this.activeRuns.add(request.runId);
    let sequence = 0;
    const emit = (type: HeadlessEvent['type'], extra: Record<string, unknown> = {}): HeadlessEvent => ({
      type,
      runId: request.runId,
      sequence: ++sequence,
      occurredAt: new Date().toISOString(),
      ...extra,
    } as HeadlessEvent);

    try {
      yield emit('accepted');
      if (request.signal?.aborted) {
      yield emit('cancelled');
        return;
      }
      const history = this.getHistory(request.sessionId, request.model);
      const config: AgentConfig = {
        model: request.model,
        modelProvider: request.modelProvider,
        maxIterations: request.maxIterations,
        memoryEnabled: request.memoryEnabled,
        signal: request.signal,
        channel: 'headless',
      };
      const agent = await this.createAgent(config);
      history.saveUserQuery(request.query);

      let answer = '';
      for await (const event of agent.run(request.query, history)) {
        if (event.type === 'done') {
          answer = event.answer;
          yield emit('report', { answer });
          continue;
        }
        const mapped = mapAgentEvent(event, emit);
        if (mapped) yield mapped;
        if (request.signal?.aborted) {
          yield emit('cancelled');
          return;
        }
      }

      if (request.signal?.aborted) {
        yield emit('cancelled');
        return;
      }
      if (answer) await history.saveAnswer(answer);
      yield emit('completed', { answer });
    } catch (error) {
      if (request.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        yield emit('cancelled');
      } else {
        yield emit('failed', { error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      this.activeRuns.delete(request.runId);
    }
  }

  private *singleEvent(
    request: HeadlessRunRequest,
    type: 'failed',
    extra: { error: string },
  ): Generator<HeadlessEvent> {
    yield { type, runId: request.runId, sequence: 1, occurredAt: new Date().toISOString(), ...extra };
  }

  private getHistory(sessionId: string, model: string): InMemoryChatHistory {
    const existing = this.histories.get(sessionId);
    if (existing) return existing;
    const created = new InMemoryChatHistory(model);
    this.histories.set(sessionId, created);
    return created;
  }
}

function mapAgentEvent(
  event: Exclude<AgentEvent, { type: 'done' }>,
  emit: (type: HeadlessEvent['type'], extra?: Record<string, unknown>) => HeadlessEvent,
): HeadlessEvent | undefined {
  switch (event.type) {
    case 'thinking':
      return emit('thinking', { message: event.message });
    case 'tool_start':
      return emit('tool_start', { tool: event.tool, args: event.args });
    case 'tool_end':
      return emit('tool_end', { tool: event.tool, args: event.args, result: event.result });
    case 'tool_error':
      return emit('tool_error', { tool: event.tool, error: event.error });
    case 'stream_progress':
      return emit('progress', { message: event.mode });
    default:
      return undefined;
  }
}
