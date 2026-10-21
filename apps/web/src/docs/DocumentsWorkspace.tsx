import { useCitationResolver } from '../workspace/useCitationResolver';
import { uiText } from '../i18n';
import { ChevronDown, Columns2, Download, FileText, Loader2, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DocView } from './DocView';
import { reconcilePanes } from './panes';
import type { DocumentPanes } from './panes';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { isViewOnly } from '../workspace/boot';
import { IconButton } from '../ui/IconButton';
import { Menu, MenuItem, MenuLabel } from '../ui/Menu';
import { showToast } from '../ui/uiStore';

function ExportPdf({ slug, title }: { slug: string; title: string }) {
  const resolve=useCitationResolver();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  return <button className="sk-doc-action" type="button" disabled={busy} aria-busy={busy} onClick={async () => {
    if (running.current) return;
    running.current = true; setBusy(true);
    // Read the canonical live text at click time, including edits not yet persisted to disk.
    const text = workspace.store.getState().data?.docs[slug] ?? '';
    try {
      const { exportDocumentPdf } = await import('./pdf');
      await exportDocumentPdf(title, text, slug, resolve);
      showToast(uiText("PDF exportado."));
    } catch { showToast(uiText("Não foi possível exportar o PDF. Tente novamente.")); }
    finally { running.current = false; setBusy(false); }
  }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}<span>{busy ? uiText("Exportando…") : uiText("Exportar PDF")}</span></button>;
}

/** Stable document slots keep their own undo history and scroll when focus moves between them. */
export default function DocumentsWorkspace({ slug }: { slug: string }) {
  const docs = useWorkspace((s) => s.data?.manifest.docs ?? []);
  const source = useWorkspace((s) => s.source);
  const [stored, setPanes] = useState<DocumentPanes>(() => ({ source, slugs: [slug], active: 0 }));
  const pending = useRef(0);
  const panes = pending.current ? stored : reconcilePanes(stored, slug, docs.map((doc) => doc.slug), source);
  if (panes !== stored) setPanes(panes);
  const [ratio, setRatio] = useState(50);
  const root = useRef<HTMLDivElement>(null);
  const split = panes.slugs.length === 2;
  const activate = async (item: string) => {
    const view = workspace.store.getState().view;
    if (view.kind !== 'doc' || view.slug !== item) await workspace.show({ kind: 'doc', slug: item });
  };
  const navigate = async (next: DocumentPanes, item: string) => {
    pending.current++;
    setPanes(next);
    try { await activate(item); }
    catch { showToast(uiText("Não foi possível abrir o documento.")); }
    finally { pending.current--; setPanes((state) => ({ ...state })); }
  };
  const openAlongside = async (item: string) => {
    setRatio(50);
    await navigate({ source, slugs: [slug, item], active: 1 }, item);
  };
  return <div ref={root} className="sk-doc-workspace" data-split={split} style={{ '--doc-ratio': `${ratio}%` } as CSSProperties}>
    {panes.slugs.map((item, slot) => {
      const title = docs.find((doc) => doc.slug === item)?.title ?? item;
      const active = item === slug;
      const focus = () => activate(item);
      return <div className="sk-doc-pane" key={item} data-active={active} role="region" aria-label={uiText("Documento: {0}", [title])} onPointerDownCapture={() => { void focus(); }} onFocusCapture={() => { void focus(); }}>
        <DocView key={item} slug={item} active={active} activate={focus}
          heading={<Menu label={uiText("Selecionar documento")} align="start" trigger={<button type="button" className="sk-doc-title" aria-label={uiText("Trocar documento: {0}", [title])}><FileText size={15} /><strong>{title}</strong><ChevronDown size={12} /></button>}>
            <MenuLabel>{uiText("Abrir neste painel")}</MenuLabel>
            <div className="max-h-72 overflow-y-auto">{docs.filter((doc) => doc.slug !== panes.slugs[1 - slot]).map((doc) => <MenuItem key={doc.slug} icon={<FileText size={14} />} onSelect={() => {
              void navigate({ ...panes, slugs: panes.slugs.map((old, index) => index === slot ? doc.slug : old), active: slot }, doc.slug);
            }}>{doc.title}</MenuItem>)}</div>
          </Menu>}
          actions={<><ExportPdf slug={item} title={title} />
            {split ? <IconButton label={uiText("Fechar divisão")} onClick={() => { void navigate({ source, slugs: [item], active: 0 }, item); }}><X /></IconButton> : <Menu label={uiText("Dividir documentos")} trigger={<button type="button" className="sk-doc-action" aria-label={uiText("Dividir documentos")}><Columns2 size={14} /><span>{uiText("Dividir")}</span></button>}>
              <MenuLabel>{uiText("Abrir ao lado")}</MenuLabel>
              <div className="max-h-72 overflow-y-auto">{docs.filter((doc) => doc.slug !== item).map((doc) => <MenuItem key={doc.slug} icon={<FileText size={14} />} onSelect={() => { void openAlongside(doc.slug); }}>{doc.title}</MenuItem>)}</div>
              {!isViewOnly() && <MenuItem icon={<Plus size={14} />} onSelect={() => { pending.current++;
                void workspace.create('doc', uiText("Sem título"), '').then(openAlongside).catch(() => showToast(uiText("Não foi possível criar o documento."))).finally(() => { pending.current--; setPanes((state) => ({ ...state })); }); }}>{uiText("Criar documento ao lado")}</MenuItem>}
              {isViewOnly() && docs.length < 2 && <MenuLabel>{uiText("Nenhum outro documento disponível")}</MenuLabel>}
            </Menu>}
          </>}
        />
        {split && slot === 0 && <div className="sk-doc-resizer" role="separator" tabIndex={0} aria-label={uiText("Redimensionar documentos")} aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(ratio)} onKeyDown={(event) => {
          const next = event.key === 'ArrowLeft' ? ratio - 5 : event.key === 'ArrowRight' ? ratio + 5 : event.key === 'Home' ? 30 : event.key === 'End' ? 70 : null;
          if (next !== null) { event.preventDefault(); setRatio(Math.min(70, Math.max(30, next))); }
        }} onPointerDown={(event) => {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = root.current!.getBoundingClientRect();
          setRatio(Math.min(70, Math.max(30, (event.clientX - bounds.left) / bounds.width * 100)));
        }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />}
      </div>;
    })}
  </div>;
}
