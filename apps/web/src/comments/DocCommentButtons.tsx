import { uiText } from '../i18n';
import { MessageSquarePlus, MessagesSquare } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { toggleRightPanel, useUi } from '../ui/uiStore';
import { commentCounts } from './counts';
import { commentSelection } from './selection';
import { useComments, useWho } from './session';

/** The doc toolbar's two comment buttons: comment on the selected passage, and open the list with its count. */
export default function DocCommentButtons({ slug, disabled, activate }: { slug: string; disabled: boolean; activate?: () => Promise<void> }) {
  const open = useUi((state) => state.rightPanel === 'comments');
  const file = useComments((state) => state.file);
  const target = useComments((state) => state.target);
  const summary = useComments((state) => state.summary);
  const who = useWho();
  const count = target?.kind === 'doc' && target.slug === slug ? commentCounts({ file, target, summary }, who).open : summary[`doc:${slug}`]?.open ?? 0;
  return (
    <>
      {who.canWrite && (
        <IconButton label={uiText("Comentar a seleção (⌘⌥M)")} title={uiText("Comentar o trecho selecionado (⌘⌥M)")} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { void (activate?.() ?? Promise.resolve()).then(commentSelection); }}>
          <MessageSquarePlus />
        </IconButton>
      )}
      <IconButton label={count ? uiText("Comentários ({0})", [count]) : uiText("Comentários")} title={uiText("Conversas ancoradas em trechos do documento")} pressed={open} onClick={() => toggleRightPanel('comments')}>
        <MessagesSquare />
        {count > 0 && <span className="text-caption font-medium">{count}</span>}
      </IconButton>
    </>
  );
}
