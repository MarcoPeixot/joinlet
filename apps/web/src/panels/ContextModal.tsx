import { uiText } from '../i18n';
import { AGENTS_SNIPPET, ARCHITECTURE_PATH, slugify } from '@strukt/workspace';
import { Bot, Copy, Download, FileArchive } from 'lucide-react';
import { closeAgentContext, useAgentContext } from '../context/session';
import { downloadBlob } from '../export/png';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { showToast } from '../ui/uiStore';
import { useWorkspace } from '../workspace/appWorkspace';

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function size(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`;
}

function download(path: string, text: string) {
  const type = path.endsWith('.md') ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
  downloadBlob(new Blob([text], { type }), baseName(path));
}

/** What "Gerar contexto para agentes" wrote: the files (download one or all), the AGENTS.md snippet and a preview. */
export function ContextModal() {
  const open = useAgentContext((s) => s.open);
  const status = useAgentContext((s) => s.status);
  const files = useAgentContext((s) => s.files);
  const source = useWorkspace((s) => s.source);
  const name = useWorkspace((s) => s.data?.manifest.name ?? 'workspace');
  const where = source?.kind === 'folder' ? `${source.label}/context/` : ".arch/context/";
  const copy = () =>
    navigator.clipboard.writeText(AGENTS_SNIPPET).then(
      () => showToast(uiText("Trecho copiado.")),
      () => showToast(uiText("Não foi possível copiar o trecho.")),
    );
  const zip = async () => {
    let zipFiles;
    try {
      ({ zipFiles } = await import('@strukt/workspace/zip'));
    } catch {
      showToast(uiText("Não foi possível carregar o exportador de .zip."));
      return;
    }
    downloadBlob(new Blob([zipFiles(files)], { type: 'application/zip' }), `${slugify(name)}-contexto.zip`);
  };
  return (
    <Modal
      open={open}
      onClose={closeAgentContext}
      label={uiText("Contexto para agentes")}
      icon={<Bot size={16} />}
      closeLabel={uiText("Fechar contexto")}
      actions={
        <IconButton label={uiText("Baixar .zip")} disabled={status !== 'ready'} onClick={zip}>
          <FileArchive />
          <span className="text-caption font-medium">{uiText("Baixar .zip")}</span>
        </IconButton>
      }
    >
      <div className="flex min-h-40 flex-col gap-5 overflow-y-auto px-6 py-5 text-body">
        {status === 'loading' && <p className="sk-shimmer font-medium">{uiText("Gerando o contexto…")}</p>}
        {status === 'ready' && (
          <>
            <p className="leading-relaxed text-muted">{uiText("Gravado em")} <code className="rounded-chip bg-panel-2 px-1.5 py-0.5 font-mono text-caption text-ink">{where}</code>
              {source?.kind === 'folder' ? '' : uiText(" (no navegador)")} {uiText("e atualizado sozinho a cada mudança nos diagramas e documentos.")}</p>
            <ul aria-label={uiText("Arquivos gerados")} className="flex flex-col overflow-hidden rounded-control border border-line">
              {Object.entries(files).map(([path, text]) => (
                <li key={path} className="flex items-center gap-2 border-b border-line py-1 pl-3 pr-1 last:border-b-0">
                  <code className="min-w-0 flex-1 truncate font-mono text-caption">{".arch/"}{path}</code>
                  <span className="font-mono text-meta text-faint">{size(text)}</span>
                  <IconButton label={uiText("Baixar {0}", [baseName(path)])} onClick={() => download(path, text)}>
                    <Download />
                  </IconButton>
                </li>
              ))}
            </ul>
            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h3 className="sk-label">{uiText("Para agentes de código")}</h3>
                <div className="ml-auto">
                  <IconButton label={uiText("Copiar trecho")} onClick={() => void copy()}>
                    <Copy />
                    <span className="text-caption font-medium">{uiText("Copiar")}</span>
                  </IconButton>
                </div>
              </div>
              <p className="text-muted">{uiText("Cole no AGENTS.md (ou CLAUDE.md) na raiz do repositório:")}</p>
              <pre aria-label={uiText("Trecho para AGENTS.md")} className="overflow-x-auto whitespace-pre-wrap rounded-control border border-line bg-panel-2 p-3 font-mono text-caption">
                {AGENTS_SNIPPET}
              </pre>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-caption font-medium text-muted">ARCHITECTURE.md</h3>
              <pre aria-label={uiText("Prévia do ARCHITECTURE.md")} className="max-h-80 overflow-auto rounded-control border border-line bg-panel-2 p-3 font-mono text-caption">
                {files[ARCHITECTURE_PATH] ?? ''}
              </pre>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
