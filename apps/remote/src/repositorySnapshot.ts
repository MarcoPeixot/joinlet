import { githubApi } from './githubWorkspace';
import { sourcePath } from '@strukt/workspace/repository-reader';
import type { RepositoryEntry, RepositoryReader } from '@strukt/workspace/repository-contracts';

const treeCache = new Map<string, Tree>();
const blobCache = new Map<string,string|null>();
type Tree = { truncated?: boolean; tree: { path: string; type: string; sha: string; size?: number; mode?: string }[] };
/** Immutable read-only Git object reader; does not execute, clone, install or evaluate repository code. */
export async function githubSnapshot(token: string, repo: string, branch: string, fetcher?: typeof fetch): Promise<RepositoryReader & { sha: string }> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.includes('..') || !branch || branch.length > 200 || /[\x00-\x20~^:?*\[\\]/.test(branch) || branch.includes('..')) throw Error('Invalid repository or branch.');
  const api = githubApi(token, fetcher), base = `/repos/${repo}`;
  const ref = await api<{ object: { sha: string } }>(`${base}/git/ref/heads/${encodeURIComponent(branch)}`), sha = ref.object.sha;
  const commit = await api<{ tree: { sha: string } }>(`${base}/git/commits/${sha}`);
  const entries: RepositoryEntry[] = [];
  const walk = async (treeSha: string, prefix: string) => {
    let tree = treeCache.get(treeSha);
    if(!tree) { tree=await api<Tree>(`${base}/git/trees/${treeSha}`); if(treeCache.size>2000)treeCache.delete(treeCache.keys().next().value!); treeCache.set(treeSha,tree); }
    if (tree.truncated) throw Error('GitHub tree inventory was truncated; synchronization is incomplete.');
    for (const item of tree.tree) {
      const path = prefix + item.path;
      if (!sourcePath(path)) continue;
      if (entries.length >= 100_000) throw Error('Repository inventory limit reached.');
      if (item.type === 'tree') await walk(item.sha, path + '/');
      else if (item.type === 'blob' && item.mode !== '120000') entries.push({ path, revision: item.sha, bytes: item.size });
    }
  };
  await walk(commit.tree.sha, ''); entries.sort((a,b)=>a.path.localeCompare(b.path));
  const blobs = new Map(entries.map(e => [e.path,e]));
  const cache = blobCache;
  return { sha, revision: async () => sha, list: async () => entries,
    async read(path) {
      const entry = blobs.get(path); if (!entry || (entry.bytes ?? 0) > 2_000_000) return null;
      if (cache.has(entry.revision)) return cache.get(entry.revision)!;
      const blob = await api<{ content: string; encoding: string }>(`${base}/git/blobs/${entry.revision}`);
      if (blob.encoding !== 'base64') throw Error('Unsupported GitHub blob encoding.');
      const bytes = Buffer.from(blob.content.replace(/\s/g,''),'base64');
      const text = bytes.byteLength > 2_000_000 || bytes.includes(0) ? null : bytes.toString('utf8');
      if(cache.size>20_000)cache.delete(cache.keys().next().value!);
      cache.set(entry.revision,text); return text;
    },
  };
}
