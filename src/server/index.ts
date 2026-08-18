import { config } from 'dotenv';
import { loadServerConfig } from './config.js';
import { DexterGrpcServer } from './grpc-server.js';

config({ quiet: true });
const server = new DexterGrpcServer(loadServerConfig());
await server.start();

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
