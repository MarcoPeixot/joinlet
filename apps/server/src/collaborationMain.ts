import { ADMIN_PLAN, BETA_PLAN } from '@strukt/workspace';
import { startCollaborationHost } from './collaborationHost';

// Last line of defense: a failure nobody awaited (a guest's message, a room that did not open) is logged and the host
// keeps serving the other guests; Bun would otherwise exit on it.
process.on('unhandledRejection', (reason: unknown) => {
  console.error(`Colaboração: falha não tratada (o host continua): ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

const root = process.env.STRUKT_COLLAB_ROOT;
if (!root) throw new Error('Defina STRUKT_COLLAB_ROOT com a pasta do workspace.');
const host = await startCollaborationHost({
  root,
  accessPlan: process.env.JOINLET_LOCAL_ADMIN === '1' ? ADMIN_PLAN : BETA_PLAN,
  port: Number(process.env.STRUKT_COLLAB_PORT || 8790),
  publicUrl: process.env.STRUKT_COLLAB_PUBLIC_URL,
  token: process.env.STRUKT_COLLAB_TOKEN,
  viewToken: process.env.STRUKT_COLLAB_VIEW_TOKEN,
  databasePath: process.env.STRUKT_COLLAB_DB,
  hostname: process.env.STRUKT_COLLAB_HOST || undefined,
  dist: process.env.STRUKT_COLLAB_DIST || undefined,
});
console.log(`Sessão de colaboração: ${host.inviteUrl}`);
console.log(`Somente leitura: ${host.viewUrl}`);

// Ctrl+C or a service stop: every open room writes its pending projection before the process exits.
let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`Colaboração: encerrando (${signal}); gravando as salas abertas…`);
  setTimeout(() => {
    console.error('Colaboração: as salas não terminaram de gravar em 15 s; saindo mesmo assim.');
    process.exit(1);
  }, 15_000).unref();
  host.stop().then(() => process.exit(0), (error: unknown) => {
    console.error(`Colaboração: falha ao gravar as salas: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
