import { commentCounts, describeCounts } from './counts';
import { useComments, useWho } from './session';

/**
 * A small count on the "Painéis" trigger: what mentions you (an accent chip) or, failing that, how many conversations
 * are open. A screen reader hears the same in words, and again when it changes (a mention arriving).
 */
export default function CommentsBadge() {
  const file = useComments((state) => state.file);
  const target = useComments((state) => state.target);
  const summary = useComments((state) => state.summary);
  const who = useWho();
  const counts = commentCounts({ file, target, summary }, who);
  const words = describeCounts(counts);
  return (
    <>
      <span role="status" className="sr-only">{words}</span>
      {words && (
        <span aria-hidden className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none ${counts.mentions ? 'bg-accent-strong text-accent-ink' : 'border border-line bg-panel text-muted'}`}>
          {counts.mentions ? `@${counts.mentions}` : counts.open}
        </span>
      )}
    </>
  );
}
