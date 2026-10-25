import ignore from 'ignore';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, join, sep, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { validEvidencePath } from '../evidence';
import type { RepositoryEntry, RepositoryReader } from './contracts';

export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const SKIP = new Set(['.git', '.arch', '.codex', '.cursor', '.vscode', '.idea', 'node_modules', '.terraform', 'dist', 'build', 'coverage', '.next', '.cache', '.venv', 'venv', '__pycache__', 'vendor', 'target']);
export const sourcePath = (path: string) => validEvidencePath(path) && !/^(?:AGENTS|CLAUDE)\.md$/i.test(path) && !path.split('/').some(p => SKIP.has(p)) && !/(^|\/)(?:\.env(?:\..*)?|\.mcp\.json|\.npmrc|\.pypirc|\.netrc|credentials(?:\.[^/]*)?|id_rsa|.*\.(?:pem|key|p12|pfx|sqlite|db|log|zip|gz|map)|(?:bun|package|pnpm|yarn|Cargo)\.lock|package-lock\.json)$/.test(path);
export function command(cmd: string, args: string[], cwd: string, timeout = 15_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(done => execFile(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 16_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (error, stdout, stderr) => done({ code: error ? 1 : 0, stdout, stderr })));
}
export async function localReader(directory: string, options: { incremental?: boolean } = {}): Promise<RepositoryReader & { root: string; invalidate(path?: string): void }> {
  const root = await realpath(resolve(directory));
  if (!(await lstat(root)).isDirectory()) throw Error('Choose a directory.');
  const contained = (path: string) => path === root || path.startsWith(root + sep);
  let entries: RepositoryEntry[] = [];
  let indexed = false, full = true, gitRepository = false;
  const rules = new Map<string, ReturnType<typeof ignore>>();
  const ignored = async (path: string, directory = false) => {
    let result = false; const parts = path.split('/');
    for (let depth = 0; depth < parts.length; depth++) {
      const base = parts.slice(0, depth).join('/');
      let rule = rules.get(base);
      if (!rule) { rule = ignore().add(await readFile(join(root, base, '.gitignore'), 'utf8').catch(() => '')); rules.set(base, rule); }
      const match = rule.test(parts.slice(depth).join('/') + (directory ? '/' : ''));
      if (match.ignored) result = true; else if (match.unignored) result = false;
    }
    return result;
  };
  const dirty = new Set<string>();
  return {
    root,
    invalidate(path) { if(!path || path.startsWith('.git/') || /(^|\/)\.gitignore$/.test(path)) { full=true; rules.clear(); } else dirty.add(path); },
    async list() {
      if(options.incremental && indexed && !full) {
        const paths=[...dirty];dirty.clear();
        const index=new Map(entries.map(entry=>[entry.path,entry]));
        const scan=async(path:string):Promise<void>=>{
          if(!sourcePath(path))return;
          const target=join(root,path),info=await lstat(target).catch(()=>null);
          if(!info || info.isSymbolicLink()) { index.delete(path); for(const key of index.keys())if(key.startsWith(path+'/'))index.delete(key); return; }
          if(!contained(await realpath(target)))return;
          if(info.isDirectory()) { if(!gitRepository && await ignored(path,true))return; for(const entry of await readdir(target,{withFileTypes:true}))await scan(path+'/'+entry.name); }
          else if(info.isFile()) { const excluded=gitRepository ? (await command('git',['check-ignore','--quiet','--',path],root)).code===0 : await ignored(path); if(!excluded)index.set(path,{path,revision:`${info.mtimeMs}:${info.size}:${info.ino}`,bytes:info.size}); else index.delete(path); }
        };
        for(const path of paths)await scan(path);
        entries=[...index.values()].sort((a,b)=>a.path.localeCompare(b.path));return entries;
      }
      full=false;indexed=true;dirty.clear();
      const tracked = await command('git', ['ls-files', '-co', '--exclude-standard', '-z'], root);
      let paths: string[];
      if (tracked.code === 0) { gitRepository = true; paths = [...new Set(tracked.stdout.split('\0').filter(Boolean))]; }
      else {
        if((await command('git',['rev-parse','--is-inside-work-tree'],root)).code===0)throw Error('Git inventory failed or exceeded its output limit. Narrow the selected repository.');
        gitRepository = false;
        paths = [];
        let visited = 0;
        const walk = async (dir: string) => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (++visited > 100_000) throw Error('Repository inventory limit reached. Narrow the selected directory.');
            if (entry.isSymbolicLink() || SKIP.has(entry.name)) continue;
            const full = join(dir, entry.name);
            const path = relative(root,full).split(sep).join('/');
            if (!sourcePath(path) || await ignored(path,entry.isDirectory())) continue;
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) paths.push(relative(root, full).split(sep).join('/'));
          }
        };
        await walk(root);
      }
      entries = [];
      for (const path of paths.sort().filter(sourcePath)) {
        const full = join(root, path);
        const info = await lstat(full).catch(() => null);
        if (!info?.isFile() || !contained(await realpath(full))) continue;
        entries.push({ path, revision: `${info.mtimeMs}:${info.size}:${info.ino}`, bytes: info.size });
      }
      entries.sort((a,b)=>a.path.localeCompare(b.path));
      return entries;
    },
    async revision() {
      // Content metadata also covers uncommitted code. Ignore generated .arch to avoid feedback loops.
      const head = await command('git', ['rev-parse', 'HEAD'], root);
      return digest(head.stdout.trim() + '\n' + entries.map(e => `${e.path}:${e.revision}`).sort().join('\n'));
    },
    async read(path) {
      if (!sourcePath(path)) return null;
      const full = join(root, path), info = await lstat(full).catch(() => null);
      if (!info?.isFile() || info.size > 2_000_000 || !contained(await realpath(full))) return null;
      const text = await readFile(full, 'utf8');
      return text.includes('\0') ? null : text;
    },
  };
}

export async function inspectGit(root: string, refresh = false) {
  const git = (args: string[]) => command('git', args, root);
  const version = await git(['--version']);
  const found = await git(['rev-parse', '--show-toplevel']);
  if (found.code) return { available: version.code === 0, version: version.stdout.trim(), repository: false, branch: null, upstream: null, ahead: null, behind: null, remoteFresh: false, dirty: false };
  const [branch, upstream, status, remote] = await Promise.all([git(['branch', '--show-current']), git(['rev-parse', '--abbrev-ref', '@{upstream}']), git(['status', '--porcelain']), git(['remote'])]);
  const fetched = refresh && remote.stdout.trim() ? await git(['fetch', '--no-tags', '--quiet']) : null;
  const counts = upstream.code === 0 ? await git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']) : null;
  const [ahead, behind] = counts?.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [null, null];
  return { available: true, version: version.stdout.trim(), repository: true, branch: branch.stdout.trim() || null, upstream: upstream.code ? null : upstream.stdout.trim(), ahead, behind, remoteFresh: fetched?.code === 0, dirty: !!status.stdout.trim() };
}
