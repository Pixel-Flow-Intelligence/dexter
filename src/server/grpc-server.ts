import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import { loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync, type PackageDefinition } from '@grpc/proto-loader';
import { HeadlessRunner } from '../headless/runner.js';
import type { HeadlessEvent, HeadlessEventInput, HeadlessRunRequest } from '../headless/types.js';
import { RunStore } from './run-store.js';
import type { DexterServerConfig } from './config.js';

type RpcMessage = Record<string, unknown>;
type ExecuteCall = grpc.ServerDuplexStream<RpcMessage, RpcMessage>;
type UnaryCall = grpc.ServerUnaryCall<RpcMessage, RpcMessage>;
type UnaryCallback = grpc.sendUnaryData<RpcMessage>;
type DexterServiceDefinition = grpc.ServiceDefinition;

export class DexterGrpcServer {
  private readonly server = new grpc.Server();
  private readonly store: RunStore;
  private readonly runner: HeadlessRunner;
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly config: DexterServerConfig) {
    this.store = new RunStore(config.eventBufferSize);
    this.runner = new HeadlessRunner({ maxConcurrentRuns: config.maxConcurrentRuns });
    const definition = loadPackageDefinition(loadProto()) as unknown as {
      nofx: { dexter: { v1: { DexterRuntimeService: { service: DexterServiceDefinition } } } };
    };
    this.server.addService(definition.nofx.dexter.v1.DexterRuntimeService.service, this.handlers());
  }

  async start(): Promise<void> {
    const address = `${this.config.host}:${this.config.port}`;
    await new Promise<void>((resolve, reject) => {
      this.server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    process.stdout.write(`Dexter gRPC server listening on ${address}\n`);
  }

  async stop(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await new Promise<void>((resolve) => this.server.tryShutdown(() => resolve()));
  }

  private handlers(): grpc.UntypedServiceImplementation {
    return {
      Execute: (call: ExecuteCall) => this.execute(call),
      GetRun: (call: UnaryCall, callback: UnaryCallback) => this.getRun(call, callback),
      CancelRun: (call: UnaryCall, callback: UnaryCallback) => this.cancelRun(call, callback),
      ResumeRun: (call: UnaryCall, callback: UnaryCallback) => this.resumeRun(call, callback),
      HealthCheck: (call: UnaryCall, callback: UnaryCallback) => this.healthCheck(call, callback),
    };
  }

  private execute(call: ExecuteCall): void {
    if (!this.authorized(call.metadata)) {
      call.destroy(new Error('Unauthenticated'));
      return;
    }
    let started = false;
    call.on('data', (command: RpcMessage) => {
      const start = command.start_run as RpcMessage | undefined;
      if (!start || started) return;
      started = true;
      void this.startRun(start, call);
    });
  }

  private async startRun(start: RpcMessage, call: ExecuteCall): Promise<void> {
    const runId = stringValue(start.run_id);
    if (!runId) {
      call.destroy(new Error('start_run.run_id is required'));
      return;
    }
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    this.store.create(runId);
    const request: HeadlessRunRequest = {
      runId,
      sessionId: stringValue(start.session_id) || runId,
      query: stringValue(start.prompt),
      model: stringValue(start.model) || 'gpt-5.6-sol',
      modelProvider: stringValue(start.model_provider) || 'openai',
      maxIterations: numberValue(start.max_iterations),
      memoryEnabled: Boolean(start.memory_enabled),
      signal: controller.signal,
    };
    try {
      for await (const event of this.runner.run(request)) {
        const stored = this.store.append(runId, stripRuntimeFields(event));
        if (stored) call.write(toRpcEvent(stored));
      }
    } finally {
      this.controllers.delete(runId);
      call.end();
    }
  }

  private getRun(call: UnaryCall, callback: UnaryCallback): void {
    if (!this.authorized(call.metadata)) return callback(new Error('Unauthenticated'));
    const request = call.request;
    const run = this.store.get(stringValue(request.run_id));
    if (!run) return callback(null, { run_id: stringValue(request.run_id), status: 'missing', events: [] });
    callback(null, { run_id: run.runId, status: run.status, events: this.store.replay(run.runId, numberValue(request.after_sequence) ?? 0).map(toRpcEvent) });
  }

  private cancelRun(call: UnaryCall, callback: UnaryCallback): void {
    if (!this.authorized(call.metadata)) return callback(new Error('Unauthenticated'));
    const controller = this.controllers.get(stringValue(call.request.run_id));
    if (controller) controller.abort();
    callback(null, { accepted: Boolean(controller) });
  }

  private resumeRun(call: UnaryCall, callback: UnaryCallback): void {
    if (!this.authorized(call.metadata)) return callback(new Error('Unauthenticated'));
    const run = this.store.get(stringValue(call.request.run_id));
    if (!run) return callback(null, { run_id: stringValue(call.request.run_id), status: 'missing', events: [] });
    callback(null, { run_id: run.runId, status: run.status, events: this.store.replay(run.runId, numberValue(call.request.after_sequence) ?? 0).map(toRpcEvent) });
  }

  private healthCheck(call: UnaryCall, callback: UnaryCallback): void {
    if (!this.authorized(call.metadata)) return callback(new Error('Unauthenticated'));
    callback(null, { status: 'ready', version: this.config.version, active_runs: this.controllers.size });
  }

  private authorized(metadata: grpc.Metadata): boolean {
    if (!this.config.token) return process.env.NODE_ENV !== 'production';
    return metadata.get('authorization').some((value) => value === `Bearer ${this.config.token}`);
  }
}

function loadProto(): PackageDefinition {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../proto/nofx/dexter/v1/dexter_runtime.proto');
  return loadSync(root, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }) as unknown as PackageDefinition;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function stripRuntimeFields(event: HeadlessEvent): HeadlessEventInput {
  const { runId: _runId, sequence: _sequence, occurredAt: _occurredAt, ...rest } = event;
  return rest;
}

function toRpcEvent(event: HeadlessEvent): RpcMessage {
  const base = { run_id: event.runId, sequence: event.sequence, occurred_at: event.occurredAt };
  switch (event.type) {
    case 'accepted': return { ...base, accepted: {} };
    case 'report': return { ...base, report: { answer: event.answer } };
    case 'completed': return { ...base, completed: { answer: event.answer ?? '' } };
    case 'failed': return { ...base, failed: { error: event.error ?? '' } };
    case 'cancelled': return { ...base, cancelled: {} };
    default: return { ...base, progress: { message: event.message ?? '', tool: event.tool ?? '', result: event.result ?? '', error: event.error ?? '' } };
  }
}
