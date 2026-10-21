import { splitShortcut } from './shortcut';

/** A shortcut as key caps: "⇧⌘Z" → ⇧ ⌘ Z. */
export function Keys({ combo, className = '' }: { combo: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-hidden>
      {splitShortcut(combo).map((key, i) => (
        <kbd key={`${key}${i}`}>{key}</kbd>
      ))}
    </span>
  );
}
