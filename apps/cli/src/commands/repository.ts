import { mkdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { watch } from 'node:fs';
import { RepositoryEngine } from '@strukt/workspace/repository';
import { inspectGit, localReader, sourcePath } from '@strukt/workspace/repository-reader';
import { createFsAdapter } from '@strukt/workspace/fs';
import { repositoryLocale } from '@strukt/workspace/repository-contracts';
import { syncAgentInstructions } from '@strukt/workspace/repository-agents';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';

export async function runRepository(args: CliArgs, io: CliIo): Promise<number> {
  if (args.command === 'connect') {
    const { connectLocal } = await import('../../../server/src/connector');
    await connectLocal({ dir: args.dirExplicit ? resolve(args.dir) : undefined, cloud: args.cloudUrl, pair: args.pair, io });
    return 0;
  }
  const reader = await localReader(args.dir, { incremental: args.command === 'watch' }), arch = join(reader.root, '.arch');
  if (!args.check) await mkdir(arch, { recursive: true });
  const { localRepositoryAi } = await import('../../../server/src/localRepositoryAi');
  const { analyzer } = await localRepositoryAi();
  const adapter=createFsAdapter(arch);if(!args.check)await adapter.recover();
  const engine = new RepositoryEngine(reader, adapter, analyzer);
  const once = async () => {
    const instructions=args.check?{changed:[],conflicts:[]}:await syncAgentInstructions(reader.root);
    const result = await engine.run({ check: args.check, name: basename(reader.root), locale: repositoryLocale(Intl.DateTimeFormat().resolvedOptions().locale) });
    if(instructions.conflicts.length){result.status.pending.push('Agent instructions need review: '+instructions.conflicts.join(', '));result.status.phase='review';}
    if (args.json) io.out(JSON.stringify({ ...result.status, changed: result.changed }));
    else {
      io.out(`Joinlet: ${result.status.phase}; ${result.status.metrics.files} files; ${result.status.metrics.reads} read; ${result.changed.length} architecture files changed.`);
      for (const pending of result.status.pending) io.out(pending);
    }
    return args.check && (result.changed.length || result.status.pending.length || result.status.proposals.length) ? 1 : 0;
  };
  const code = await once();
  if (args.command !== 'watch') return code;
  let timer: ReturnType<typeof setTimeout> | undefined, queued = false, running = false;
  const run = async () => {
    if (running) { queued = true; return; }
    running = true;
    try { await once(); } catch (error) { io.err(String(error)); }
    finally { running = false; if (queued) { queued = false; void run(); } }
  };
  const watcher = watch(reader.root, { recursive: true }, (_event, path) => {
    const p = String(path ?? '').replaceAll('\\','/');
    if (!sourcePath(p) && p !== '.git/HEAD' && !p.startsWith('.git/refs/heads/')) return;
    reader.invalidate(p);
    clearTimeout(timer); timer = setTimeout(() => void run(), 750);
  });
  io.out(`Joinlet watching ${reader.root}.`);
  await new Promise<void>(done => { const stop = () => { watcher.close(); clearTimeout(timer); process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); done(); }; process.once('SIGINT',stop); process.once('SIGTERM',stop); });
  return 0;
}
