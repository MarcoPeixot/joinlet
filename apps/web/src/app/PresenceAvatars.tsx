import { uiText } from '../i18n';
import type { Collaborator } from '../workspace/collaboration';

const MAX = 4;

/** "Ana Souza" → "AS"; one letter for a single word. */
export const initials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join('') || '?';

/** The other people in the room: a stack of colored initials (the full name on hover), "+N" past four. */
export function PresenceAvatars({ people }: { people: readonly Collaborator[] }) {
  if (!people.length) return null;
  return (
    <span role="list" aria-label={uiText("Outras pessoas na sala")} className="flex items-center -space-x-1.5">
      {people.slice(0, MAX).map((person) => (
        <span key={person.id} role="listitem" title={person.name} aria-label={person.name} data-person={person.name} className="grid h-6 w-6 place-items-center rounded-full border-2 border-panel text-[10px] font-semibold text-white" style={{ backgroundColor: person.color }}>
          {initials(person.name)}
        </span>
      ))}
      {people.length > MAX && <span role="listitem" className="grid h-6 min-w-6 place-items-center rounded-full border-2 border-panel bg-panel-3 px-1 text-[10px] font-semibold text-muted">{"+"}{people.length - MAX}</span>}
    </span>
  );
}
