import type { HeadlessEvent, HeadlessEventInput } from '../headless/types.js';

export type RunStatus = 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface StoredRun {
  runId: string;
  status: RunStatus;
  events: HeadlessEvent[];
  eventIds: Map<string, HeadlessEvent>;
  updatedAt: number;
}

export class RunStore {
  private readonly runs = new Map<string, StoredRun>();

  constructor(private readonly eventLimit = 500) {}

  create(runId: string): StoredRun {
    const existing = this.runs.get(runId);
    if (existing) return existing;
    const run: StoredRun = {
      runId,
      status: 'accepted',
      events: [],
      eventIds: new Map(),
      updatedAt: Date.now(),
    };
    this.runs.set(runId, run);
    return run;
  }

  get(runId: string): StoredRun | undefined {
    return this.runs.get(runId);
  }

  append(runId: string, event: HeadlessEventInput, eventId?: string): HeadlessEvent | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    if (eventId) {
      const previous = run.eventIds.get(eventId);
      if (previous) return previous;
    }
    if (isTerminal(run.status)) return null;
    const fullEvent = {
      ...event,
      runId,
      sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
      occurredAt: new Date().toISOString(),
    } as HeadlessEvent;
    run.events.push(fullEvent);
    if (eventId) run.eventIds.set(eventId, fullEvent);
    if (fullEvent.type === 'completed' || fullEvent.type === 'failed' || fullEvent.type === 'cancelled') {
      run.status = fullEvent.type;
    } else if (fullEvent.type !== 'accepted') {
      run.status = 'running';
    }
    if (run.events.length > this.eventLimit) run.events.splice(0, run.events.length - this.eventLimit);
    run.updatedAt = Date.now();
    return fullEvent;
  }

  replay(runId: string, afterSequence: number): HeadlessEvent[] {
    return this.runs.get(runId)?.events.filter((event) => event.sequence > afterSequence) ?? [];
  }
}

function isTerminal(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
