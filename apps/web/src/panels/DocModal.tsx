import { uiText } from '../i18n';
import { markdownTitle } from '@strukt/workspace';
import { BookOpen, Copy, Download, FilePlus2 } from 'lucide-react';
import { useMemo } from 'react';
import { renderMarkdown, useMarkdownReady } from '../ai/markdown';
import { docSession, useDoc } from '../ai/session';
import { downloadBlob } from '../export/png';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { showToast } from '../ui/uiStore';
import { saveMarkdownAsDoc } from '../workspace/actions';

export function DocModal() {
  const open = useDoc((s) => s.open);
  const status = useDoc((s) => s.status);
  const markdown = useDoc((s) => s.markdown);
  const error = useDoc((s) => s.error);
  const ready = useMarkdownReady();
  const html = useMemo(() => (markdown ? renderMarkdown(markdown) : ''), [markdown, ready]);
  const copy = () =>
    navigator.clipboard.writeText(markdown).then(
      () => showToast(uiText("Documentação copiada.")),
      () => showToast(uiText("Não foi possível copiar a documentação.")),
    );
  const saveAsDoc = () => {
    docSession.close();
    void saveMarkdownAsDoc(markdownTitle(markdown) ?? uiText("Documentação da arquitetura"), markdown);
  };
  const download = () => downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), 'arquitetura.md');
  return (
    <Modal
      open={open}
      onClose={docSession.close}
      label={uiText("Documentação da arquitetura")}
      icon={<BookOpen size={16} />}
      closeLabel={uiText("Fechar documentação")}
      actions={
        <>
          <IconButton label={uiText("Copiar")} disabled={status !== 'ready'} onClick={() => void copy()}>
            <Copy />
            <span className="text-caption font-medium">{uiText("Copiar")}</span>
          </IconButton>
          <IconButton label={uiText("Salvar como doc")} disabled={status !== 'ready'} onClick={saveAsDoc}>
            <FilePlus2 />
            <span className="text-caption font-medium">{uiText("Salvar como doc")}</span>
          </IconButton>
          <IconButton label={uiText("Baixar .md")} disabled={status !== 'ready'} onClick={download}>
            <Download />
            <span className="text-caption font-medium">{uiText("Baixar .md")}</span>
          </IconButton>
        </>
      }
    >
      <div className="min-h-40 overflow-y-auto px-7 py-6">
        {status === 'loading' && <p className="sk-shimmer font-medium">{uiText("Escrevendo a documentação…")}</p>}
        {status === 'error' && <p className="text-danger">{error}</p>}
        {status === 'ready' && <article className="sk-markdown" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </Modal>
  );
}
