import { uiText } from '../i18n';
import { RefreshCw } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import type { AuditEntry } from './client';
import { describeEntry } from './format';

/** What happened in this workspace's shares, newest first: who, what path; never content. */
export function ActivityList({ entries, error, onRefresh }: { entries: readonly AuditEntry[]; error: string | null; onRefresh(): void }) {
  return (
    <section aria-label={uiText("Atividade")} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="sk-label">{uiText("Atividade ·")} {entries.length}</h3>
        <IconButton label={uiText("Atualizar atividade")} onClick={onRefresh}><RefreshCw /></IconButton>
      </div>
      {error ? (
        <p className="rounded-control border border-dashed border-line px-3 py-3 text-muted">{error}</p>
      ) : entries.length ? (
        <ul aria-label={uiText("Eventos recentes")} className="flex max-h-56 flex-col overflow-y-auto rounded-control border border-line">
          {entries.map((entry, index) => {
            const line = describeEntry(entry);
            return (
              <li key={`${index}:${entry.t}:${entry.type}`} data-activity={entry.type} className="flex items-baseline gap-2 border-b border-line px-3 py-1.5 text-caption last:border-b-0">
                <span className="w-[84px] shrink-0 font-mono text-faint">{line.when}</span>
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${line.tone === 'warn' ? 'bg-warning' : 'bg-line-strong'}`} />
                <span className="min-w-0 flex-1 break-words text-ink">{line.tone === 'warn' && <span className="sr-only">{uiText("Recusado:")} </span>}{line.text}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-control border border-dashed border-line px-3 py-3 text-muted">{uiText("Nada registrado ainda.")}</p>
      )}
    </section>
  );
}
