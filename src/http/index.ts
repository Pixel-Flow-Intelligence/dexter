import { createHttpServer } from './server.js';

process.on('uncaughtException', (error) => {
  process.stderr.write(`[dexter-http] uncaughtException ${error.stack || String(error)}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[dexter-http] unhandledRejection ${String(reason)}\n`);
});

const server = createHttpServer();
await server.start();
process.stdout.write(`Dexter HTTP SSE server listening on http://${server.hostname}:${server.port}\n`);

const shutdown = () => {
  server.stop(true);
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
