export interface DexterServerConfig {
  host: string;
  port: number;
  token?: string;
  maxConcurrentRuns: number;
  eventBufferSize: number;
  version: string;
}

export function loadServerConfig(): DexterServerConfig {
  return {
    host: process.env.DEXTER_GRPC_HOST ?? '127.0.0.1',
    port: Number(process.env.DEXTER_GRPC_PORT ?? 50071),
    token: process.env.DEXTER_SERVICE_TOKEN,
    maxConcurrentRuns: Number(process.env.DEXTER_MAX_CONCURRENT_RUNS ?? 4),
    eventBufferSize: Number(process.env.DEXTER_EVENT_BUFFER_SIZE ?? 500),
    version: process.env.DEXTER_VERSION ?? 'dev',
  };
}
