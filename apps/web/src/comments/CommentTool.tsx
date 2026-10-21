import { uiText } from '../i18n';
import { MessageSquarePlus } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { useIsMobile } from '../ui/useBreakpoint';
import { comments, useComments, useWho } from './session';

/** The comment tool in the canvas palette: a link that only views has none; one that comments has it though the diagram is read-only. */
export default function CommentTool() {
  // The palette is a column at the left edge, and a row under the bar on a phone.
  const row = useIsMobile();
  const on = useComments((state) => state.tool);
  const who = useWho();
  if (!who.canWrite) return null;
  return (
    <IconButton tooltipSide={row ? 'bottom' : 'right'} label={uiText("Comentar (C)")} title={uiText("Comentar: clique em um nó, uma conexão ou um ponto do canvas (C)")} pressed={on} onClick={() => comments.setTool(!on)}>
      <MessageSquarePlus />
    </IconButton>
  );
}
