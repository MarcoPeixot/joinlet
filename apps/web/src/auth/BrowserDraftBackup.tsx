import { useEffect, useState } from 'react';
import { MANIFEST_PATH, readFiles, slugify } from '@strukt/workspace';
import { authText as uiText } from './messages';
import { Button } from '../ui/Button';

/** Switching the hosted app from preview to accounts must leave existing browser drafts recoverable. */
export function BrowserDraftBackup() {
  const [drafts, setDrafts] = useState<{ namespace: string | null; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      const { createIdbAdapter } = await import('../workspace/idb');
      const { loadCatalog } = await import('../workspace/catalog');
      const catalog = await loadCatalog().catch(() => null);
      const namespaces = new Set<string | null>([null]);
      for (const entry of catalog?.entries ?? []) if (entry.location.kind === 'browser') namespaces.add(entry.location.namespace);
      const found: { namespace: string | null; name: string }[] = [];
      for (const namespace of namespaces) {
        const text = await createIdbAdapter(namespace).read(MANIFEST_PATH);
        if (text) {
          let name = 'workspace';
          try { const manifest = JSON.parse(text); if (typeof manifest.name === 'string') name = manifest.name; } catch { /* A damaged manifest still deserves a backup. */ }
          found.push({ namespace, name });
        }
      }
      if (active) setDrafts(found);
    })().catch(() => {});
    return () => { active = false; };
  }, []);
  if (!drafts.length) return null;
  const backup = async (draft: typeof drafts[number]) => {
    setBusy(true); setError('');
    try {
      const { createIdbAdapter } = await import('../workspace/idb');
      const { zipFiles } = await import('@strukt/workspace/zip');
      const { downloadBlob } = await import('../export/png');
      downloadBlob(new Blob([zipFiles(await readFiles(createIdbAdapter(draft.namespace), () => true))], { type: 'application/zip' }), `${slugify(draft.name)}.zip`);
    } catch { setError(uiText('Não foi possível exportar o rascunho. Seus dados continuam neste navegador.')); }
    finally { setBusy(false); }
  };
  return <aside className="w-full rounded-panel border border-line bg-panel p-4 text-left">
    <p className="text-caption text-muted">{uiText('Encontramos um workspace da prévia neste navegador. Exporte um ZIP e importe na sua conta para continuar com ele.')}</p>
    {drafts.map(draft => <Button key={draft.namespace ?? 'legacy'} className="mt-3 max-w-full" disabled={busy} onClick={() => void backup(draft)}>{uiText('Exportar rascunho: {0}', [draft.name])}</Button>)}
    {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
  </aside>;
}
