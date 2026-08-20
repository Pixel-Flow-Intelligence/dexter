import { createHttpServer } from './server.js';

const server = createHttpServer();
await server.start();
process.stdout.write(`Dexter HTTP SSE server listening on http://${server.hostname}:${server.port}\n`);

const shutdown = () => {
  server.stop(true);
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
