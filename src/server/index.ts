import { config } from 'dotenv';
import { applyDexterOwnedEnv } from '../utils/env.js';
import { loadServerConfig } from './config.js';
import { DexterGrpcServer } from './grpc-server.js';

config({ quiet: true });
applyDexterOwnedEnv();
const server = new DexterGrpcServer(loadServerConfig());
await server.start();

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
