import { identifyNavigation } from './navigation';
import { uiText } from '../i18n';
import type { StorageAdapter } from '@strukt/workspace';

export function createRepositoryAdapter(root: string): StorageAdapter {
  const endpoint = `/api/workspace?dir=${encodeURIComponent(root)}`;
  const baseline = new Map<string, string | null>();
  async function response(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const result = await fetch(url, init);
    const data = await result.json() as Record<string, unknown>;
    if (!result.ok) throw new Error(typeof data.error === 'string' ? data.error : uiText("Falha ao acessar o repositório."));
    return data;
  }
  const update = (body: Record<string, unknown>) => response('/api/workspace', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: root, ...body }),
  });
  return identifyNavigation({
    kind: 'folder',
    label: `${root}/.arch`,
    async read(path) {
      const text = (await response(`${endpoint}&path=${encodeURIComponent(path)}`)).text as string | null;
      baseline.set(path, text);
      return text;
    },
    async write(path, text) {
      await update({ path, text, ...(!path.startsWith('context/') ? { expected: baseline.get(path) ?? null } : {}) });
      baseline.set(path, text);
    },
    async remove(path) {
      await update({ path, remove: true, ...(!path.startsWith('context/') ? { expected: baseline.get(path) ?? null } : {}) });
      baseline.set(path, null);
    },
    async batch(changes) {
      const mutations = changes.filter(change => !change.path.startsWith('context/')).map(change => ({ ...change, expected: baseline.get(change.path) ?? change.expected }));
      await response('/api/workspace/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: root, changes: mutations }) });
      for (const change of mutations) baseline.set(change.path, change.text);
    },
    async list() { return (await response(endpoint)).files as string[]; },
    async stamps() { return (await response(endpoint)).stamps as Record<string, number>; },
  }, `repository:${root}`);
}
