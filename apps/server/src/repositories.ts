import { applyRepositoryProposal, discardRepositoryProposal } from './repositoryReview';
import { watch } from 'node:fs';
import { basename, join } from 'node:path';
import { mkdir, lstat } from 'node:fs/promises';
import { RepositoryEngine, inspectRepository,readRepositoryConfig } from '@strukt/workspace/repository';
import { inspectGit, localReader, sourcePath } from '@strukt/workspace/repository-reader';
import { createFsAdapter } from '@strukt/workspace/fs';
import type { RepositoryAnalyzer, RepositoryJob, RepositoryLocale, RepositoryStatus } from '@strukt/workspace/repository-contracts';
import { command } from '@strukt/workspace/repository-reader';
import { syncAgentInstructions } from '@strukt/workspace/repository-agents';
import {repositorySourceContext,repositorySourceIdentity,listRepositoryFiles,readRepositorySource,scopedRepositoryReader} from '@strukt/workspace/repository-source-access';

/** Native dialog is opened only by an explicit UI action, never by a path supplied by a remote caller. */
export async function chooseRepositoryFolder(): Promise<string | null> {
  const [cmd, args] = process.platform === 'darwin' ? ['osascript', ['-e', 'POSIX path of (choose folder with prompt "Connect a folder to Joinlet")']] as const
    : process.platform === 'win32' ? ['powershell.exe', ['-NoProfile','-Command','Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq "OK") { $dialog.SelectedPath }']] as const
    : ['zenity', ['--file-selection', '--directory', '--title=Joinlet']] as const;
  const result = await command(cmd, [...args], process.cwd(), 120_000);
  if (result.code && /cancel|canceled|-128/i.test(result.stderr)) return null;
  if (result.code) throw Error('Native folder picker is unavailable. Enter the folder path or run joinlet connect --dir <folder>.');
  return result.stdout.trim() || null;
}
interface Connection { root: string; locale?: RepositoryLocale; engine: RepositoryEngine; job: RepositoryJob; timer?: ReturnType<typeof setTimeout>; stop?: () => void; listeners: Set<(job: RepositoryJob) => void>; running: boolean; again: boolean; abort?: AbortController; gitAt?: number }
export function createRepositoryService(analyzer: () => RepositoryAnalyzer | undefined = () => undefined) {
  const connections = new Map<string, Connection>();
  const notify = (c: Connection, status: Partial<RepositoryStatus>) => { c.job = { ...c.job, ...status, updated: Date.now() }; for (const listener of c.listeners) listener(c.job); };
  const start = (c: Connection) => {
    if (c.running) { c.again = true; return; }
    c.running = true; c.abort=new AbortController(); notify(c, { phase: 'git', error: undefined });
    const preparation=syncAgentInstructions(c.root).then(async instructions=>{
      if(!c.gitAt||Date.now()-c.gitAt>60_000){const value=await inspectGit(c.root,true);c.gitAt=Date.now();notify(c,{git:value});}
      return instructions;
    });
    void preparation.then(async instructions => {
      const result=await c.engine.run({ signal:c.abort!.signal, name: basename(c.root), locale: c.locale, progress: s => notify(c, { ...s, id: c.job.id, root: c.root }) });
      if(instructions.conflicts.length){result.status.pending.push('Agent instructions need review: '+instructions.conflicts.join(', '));result.status.phase='review';}
      return result;
    }).then(r => notify(c, { ...r.status, id: c.job.id, root: c.root }))
      .catch(error => notify(c, { phase: /changed|conflict/i.test(String(error)) ? 'conflict' : 'error', error: error instanceof Error ? error.message : String(error) }))
      .finally(() => { c.running = false; if (c.again && connections.get(c.job.id) === c) { c.again = false; start(c); } });
  };
  return {
    async connect(directory: string, locale?: RepositoryLocale) {
      const reader = await localReader(directory, { incremental: true });
      const existing = [...connections].find(([,c]) => c.root === reader.root);
      if (existing) { start(existing[1]); return existing[1].job; }
      const existingArch = await lstat(join(reader.root, '.arch')).catch(() => null);
      if(existingArch?.isSymbolicLink()) throw Error('The .arch directory must not be a symbolic link.');
      await mkdir(join(reader.root, '.arch'), { recursive: true });
      const storage=createFsAdapter(join(reader.root,'.arch'));await storage.recover();
      const id = crypto.randomUUID(), now = Date.now();
      const job: RepositoryJob = { id, root: reader.root, phase: 'queued', completed: 0, total: 0, analyzedRevision: null, persistedRevision: null, coverage: 'none', pending: [], proposals: [], metrics: { files: 0, reads: 0, aiCalls: 0, written: 0 }, created: now, updated: now };
      const c: Connection = { root: reader.root, locale, engine: new RepositoryEngine(reader, storage, analyzer()), job, listeners: new Set(), running: false, again: false };
      const schedule = () => { clearTimeout(c.timer); c.timer = setTimeout(() => start(c), 750); };
      try { const watcher = watch(reader.root, { recursive: true }, (_event, path) => {
        const p = String(path ?? '').replaceAll('\\','/');
        reader.invalidate(p);
        if(!c.running && /^\.arch\/(?:diagrams\/|docs\/|strukt\.json$|repository\.json$|sources\.json$|evidence\.json$)/.test(p) && !p.includes('.joinlet-'))schedule();
        if (sourcePath(p) || p === '.git/HEAD' || p.startsWith('.git/refs/heads/')) schedule();
      }); c.stop = () => watcher.close(); }
      catch { notify(c, { pending: ['Filesystem events unavailable; use Sync to reconcile.'] }); }
      connections.set(id, c); start(c);
      return job;
    },
    async readSource(id: string, path: string) { const c=connections.get(id);if(!c)throw Error('Connection not found.');return (scopedRepositoryReader(c.engine.reader,readRepositoryConfig(await c.engine.adapter.read('repository.json')))).read(path); },
    async sourceContext(id:string){const c=connections.get(id);if(!c)throw Error('Connection not found.');return repositorySourceContext(scopedRepositoryReader(c.engine.reader,readRepositoryConfig(await c.engine.adapter.read('repository.json'))));},
    async sourceRevision(id:string){const c=connections.get(id);if(!c)throw Error('Connection not found.');return repositorySourceIdentity(scopedRepositoryReader(c.engine.reader,readRepositoryConfig(await c.engine.adapter.read('repository.json'))));},
    async sourceList(id:string,options:Parameters<typeof listRepositoryFiles>[1]){const c=connections.get(id);if(!c)throw Error('Connection not found.');return listRepositoryFiles(scopedRepositoryReader(c.engine.reader,readRepositoryConfig(await c.engine.adapter.read('repository.json'))),options);},
    async sourcePage(id:string,path:string,start?:number,count?:number,revision?:string){const c=connections.get(id);if(!c)throw Error('Connection not found.');return readRepositorySource(scopedRepositoryReader(c.engine.reader,readRepositoryConfig(await c.engine.adapter.read('repository.json'))),path,start,count,revision);},
    async inspect(id: string) { const c=connections.get(id);if(!c)throw Error('Connection not found.');return inspectRepository(c.engine.reader,c.engine.adapter); },
    list: () => [...connections.values()].map(c => c.job),
    get: (id: string) => connections.get(id)?.job ?? null,
    root: (id: string) => connections.get(id)?.root ?? null,
    sync(id: string) { const c = connections.get(id); if (!c) throw Error('Repository connection not found.'); start(c); return c.job; },
    subscribe(id: string, listener: (job: RepositoryJob) => void) { const c = connections.get(id); if (!c) throw Error('Repository connection not found.'); c.listeners.add(listener); return () => { c.listeners.delete(listener); }; },
    async diagnose(directory: string) { const reader = await localReader(directory); return { root: reader.root, git: await inspectGit(reader.root, true) }; },
    async review(id: string, proposalId: string, action: string) { const c=connections.get(id); if(!c)throw Error('Connection not found.'); const proposal=c.job.proposals.find(p=>p.id===proposalId);if(!proposal)throw Error('Proposal not found.');if(action==='apply')await applyRepositoryProposal(c.engine.adapter,c.engine.reader,proposal);else if(action==='dismiss')await discardRepositoryProposal(c.engine.adapter,proposalId);else throw Error('Invalid review action.');notify(c,{proposals:c.job.proposals.filter(p=>p.id!==proposalId)});return c.job; },
    disconnect(id: string) { const c = connections.get(id); if (c) { c.abort?.abort(); c.stop?.(); clearTimeout(c.timer); notify(c, { phase: 'disconnected' }); connections.delete(id); } },
    close() { for (const c of connections.values()) { c.abort?.abort(); c.stop?.(); clearTimeout(c.timer); } connections.clear(); },
  };
}
