import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createRemoteApp } from './app';
import { createRemoteCollaboration } from './collaboration';
import { remoteConfig } from './config';

const options = remoteConfig(process.env);
await mkdir(dirname(options.databasePath), { recursive: true, mode: 0o700 });
const { app, auth, hosted, drain } = createRemoteApp(options);
const collaboration = createRemoteCollaboration(options, auth, hosted);
const server = app.listen(options.port, '0.0.0.0', () => console.log(`Joinlet remote listening on port ${options.port}`));
server.on('upgrade', (request, socket, head) => void collaboration.upgrade(request, socket, head));

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  drain();
  const deadline = setTimeout(() => { console.error('Joinlet shutdown deadline exceeded.'); process.exit(1); }, 25_000);
  deadline.unref();
  const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const results = await Promise.allSettled([closed, collaboration.shutdown()]);
  clearTimeout(deadline);
  auth.close();
  const failed = results.some(result => result.status === 'rejected');
  if (failed) console.error('Joinlet could not finish all pending work during shutdown.');
  process.exit(failed ? 1 : 0);
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
