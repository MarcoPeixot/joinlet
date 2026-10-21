import { Building2, Check, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Manifest } from '@strukt/workspace';
import { systemMessage, uiText } from '../i18n';
import { useDiagram } from '../state/appStore';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/controls';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { isViewOnly } from '../workspace/boot';
import { readWorkspaceLogo } from './workspaceLogo';

export function WorkspaceSection() {
  const manifest = useWorkspace(s => s.data?.manifest);
  const source = useWorkspace(s => s.source);
  // Changing workspaces discards this workspace's unsaved form, even when their names match.
  const [owner, setOwner] = useState(source);
  const [revision, setRevision] = useState(0);
  useEffect(() => { if (owner !== source) { setOwner(source); setRevision(n => n + 1); } }, [source, owner]);
  if (!manifest) return <p className="text-body text-muted">{uiText('Abra um workspace para personalizá-lo.')}</p>;
  return <WorkspaceForm key={revision} initial={manifest} />;
}

function WorkspaceForm({ initial }: { initial: Manifest }) {
  const [base, setBase] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [logo, setLogo] = useState<string | null>(initial.logo ?? null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef(0);
  const readOnly = useDiagram(s => s.readOnly);
  const locked = !!readOnly || isViewOnly();
  const dirty = name.trim() !== base.name || description.trim() !== (base.description ?? '') || logo !== (base.logo ?? null);
  useEffect(() => () => { upload.current++; }, []);
  async function save() {
    if (locked) return;
    setError(''); setSaved(false);
    const current = workspace.store.getState().data?.manifest;
    if (!current || ['name', 'description', 'logo'].some(key => current[key as keyof Manifest] !== base[key as keyof Manifest])) {
      setError(uiText('Os dados do workspace mudaram. Reabra esta seção antes de salvar.')); return;
    }
    setBusy(true);
    const source = workspace.store.getState().source;
    try {
      workspace.setDetails({ name, description, logo });
      setBase(workspace.store.getState().data!.manifest);
      await workspace.flush();
      const state = workspace.store.getState();
      if (state.source !== source) return;
      if (state.save !== 'saved') throw new Error(state.saveError ?? uiText('As alterações ainda não foram salvas. Tente novamente.'));
      const next = state.data!.manifest;
      setBase(next); setName(next.name); setDescription(next.description ?? ''); setSaved(true);
    } catch (cause) { setError(systemMessage(cause instanceof Error ? cause.message : String(cause))); }
    finally { setBusy(false); }
  }
  return <form className="flex flex-col gap-6" onSubmit={event => { event.preventDefault(); void save(); }} onChange={() => setSaved(false)}>
    <div className="flex items-center gap-4 rounded-xl border border-line bg-panel-2/40 p-5">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-panel text-2xl font-semibold text-accent">
        {logo ? <img src={logo} alt={uiText('Prévia da logo')} className="h-full w-full object-contain" /> : name.trim().charAt(0).toUpperCase() || <Building2 size={26} />}
      </div>
      <div className="min-w-0"><p className="truncate text-title font-semibold">{name.trim() || 'Workspace'}</p><p className="mt-1 line-clamp-2 break-words text-caption text-muted">{description.trim() || uiText('Um espaço para suas ideias, diagramas e equipe.')}</p></div>
    </div>
    {locked && <p role="status" className="text-caption text-muted">{uiText('Este workspace está em modo somente leitura.')}</p>}
    <fieldset disabled={locked || busy} className="flex min-w-0 flex-col gap-5 disabled:opacity-60">
      <div className="flex flex-col gap-2">
        <span className="text-body font-medium">{uiText('Logo do workspace')}</span>
        <p className="text-caption text-muted">{uiText('PNG, JPG ou WebP, até 2 MB. Uma imagem quadrada funciona melhor.')}</p>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Upload size={14} />} onClick={() => input.current?.click()}>{uiText('Enviar logo')}</Button>
          {logo && <Button variant="ghost" onClick={() => { upload.current++; setLogo(null); setSaved(false); }}>{uiText('Remover logo')}</Button>}
        </div>
        <input ref={input} aria-label={uiText('Arquivo da logo')} className="sr-only" tabIndex={-1} type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          const request = ++upload.current;
          setError(''); setBusy(true);
          try { const value = await readWorkspaceLogo(file); if (request === upload.current) { setLogo(value); setSaved(false); } }
          catch (cause) { if (request === upload.current) setError(systemMessage(cause instanceof Error ? cause.message : String(cause))); }
          finally { if (request === upload.current) setBusy(false); }
        }} />
      </div>
      <label className="flex flex-col gap-2 text-body font-medium">{uiText('Nome do workspace')}
        <input className={`${inputClass} h-10`} value={name} required maxLength={100} onChange={event => setName(event.target.value)} autoComplete="organization" />
      </label>
      <label className="flex flex-col gap-2 text-body font-medium">{uiText('Descrição do workspace')}
        <textarea className={`${inputClass} min-h-24 resize-y py-2 font-normal`} value={description} maxLength={1000} rows={3} placeholder={uiText('O que sua equipe está construindo?')} onChange={event => setDescription(event.target.value)} />
        <span className="text-right text-caption font-normal text-faint">{description.length}/1000</span>
      </label>
    </fieldset>
    <p className="text-caption text-muted">{uiText('Essas informações pertencem a este workspace e acompanham sua exportação.')}</p>
    {error && <p role="alert" className="text-caption text-danger">{error}</p>}
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button type="submit" variant="primary" disabled={locked || busy || !name.trim() || (!dirty && !error)}>{busy ? uiText('Salvando…') : uiText('Salvar alterações')}</Button>
      {dirty && <Button disabled={busy} variant="ghost" onClick={() => { setName(base.name); setDescription(base.description ?? ''); setLogo(base.logo ?? null); setError(''); setSaved(false); }}>{uiText('Descartar alterações')}</Button>}
      {saved && <span role="status" className="flex items-center gap-1.5 text-caption text-accent"><Check size={14} />{uiText('Workspace atualizado.')}</span>}
    </div>
  </form>;
}
