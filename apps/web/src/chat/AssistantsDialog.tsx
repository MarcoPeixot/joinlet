import { uiText } from '../i18n';
import { MAX_INSTRUCTION, MAX_NAME, newAssistantId, validateAssistants } from '@strukt/workspace';
import type { Assistant, AssistantScope } from '@strukt/workspace';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Field, FieldGroup, Segmented, inputClass } from '../ui/controls';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { workspace } from '../workspace/appWorkspace';

const SCOPE_LABEL: Record<AssistantScope, string> = { diagram: uiText("Só o diagrama aberto"), workspace: uiText("Todo o workspace") };

interface Draft {
  /** `null` while writing a new one. */
  id: string | null;
  name: string;
  instruction: string;
  scope: AssistantScope;
}

const blank: Draft = { id: null, name: '', instruction: '', scope: 'diagram' };

/**
 * The workspace's own assistants (`.arch/assistants.json`, shared through git): a name, the instruction the chat sends
 * and what it reads. The built-in ones are not listed here, they are not editable.
 */
export function AssistantsDialog({ open, saved, onClose }: { open: boolean; saved: readonly Assistant[]; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = async (next: Assistant[]): Promise<boolean> => {
    try {
      await workspace.setAssistants(next);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const instruction = draft.instruction.trim();
    const existing = draft.id === null ? undefined : saved.find((item) => item.id === draft.id);
    const entry: Assistant = {
      id: existing?.id ?? newAssistantId(name || uiText("assistente"), saved),
      name,
      instruction,
      scope: draft.scope,
      ...(existing?.changes ? { changes: true as const } : {}),
    };
    const next = existing ? saved.map((item) => (item.id === existing.id ? entry : item)) : [...saved, entry];
    const invalid = validateAssistants(next);
    if (invalid) return setError(invalid);
    if (await commit(next)) setDraft(null);
  };

  const close = () => {
    setDraft(null);
    setError(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} label={uiText("Assistentes do workspace")} width={560}>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-caption leading-relaxed text-muted">{uiText("Instruções salvas que rodam no chat com o contexto atual. Ficam em")} <code className="rounded-chip bg-panel-3 px-1 font-mono text-meta">.arch/assistants.json</code> {uiText("e vão com o repositório. Eles só conversam: não editam o diagrama nem rodam sozinhos.")}</p>
        {saved.length === 0 && !draft && <p className="rounded-control border border-dashed border-line px-3 py-4 text-center text-caption text-muted">{uiText("Nenhum assistente próprio ainda.")}</p>}
        <ul className="flex flex-col gap-1.5" aria-label={uiText("Assistentes salvos")}>
          {saved.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-control border border-line bg-panel-2/60 px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-medium">{item.name}</span>
                <span className="truncate text-caption text-faint">{SCOPE_LABEL[item.scope]}</span>
              </span>
              <IconButton label={uiText("Editar {0}", [item.name])} onClick={() => { setError(null); setDraft({ id: item.id, name: item.name, instruction: item.instruction, scope: item.scope }); }}>
                <Pencil />
              </IconButton>
              <IconButton label={uiText("Excluir {0}", [item.name])} onClick={() => void commit(saved.filter((other) => other.id !== item.id)).then((done) => done && draft?.id === item.id && setDraft(null))}>
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
        {draft ? (
          <form
            className="flex flex-col gap-3 rounded-[12px] border border-line bg-panel/60 p-3"
            aria-label={draft.id === null ? uiText("Novo assistente") : uiText("Editar assistente")}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label={uiText("Nome")}>
              <input autoFocus className={`${inputClass} h-9`} maxLength={MAX_NAME} value={draft.name} placeholder={uiText("ex.: Revisar custos")} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label={uiText("Instrução")}>
              <textarea
                className={`${inputClass} min-h-28 resize-y py-2 leading-relaxed`}
                maxLength={MAX_INSTRUCTION}
                value={draft.instruction}
                placeholder={uiText("O que o chat deve fazer. Peça para citar os componentes com [[Id]].")}
                onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}
              />
            </Field>
            <FieldGroup label={uiText("O que ele lê")}>
              <Segmented<AssistantScope>
                value={draft.scope}
                options={[
                  { value: 'diagram', label: SCOPE_LABEL.diagram },
                  { value: 'workspace', label: SCOPE_LABEL.workspace },
                ]}
                onChange={(scope) => setDraft({ ...draft, scope })}
              />
            </FieldGroup>
            {error && <p role="alert" className="text-caption text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setDraft(null); setError(null); }}>{uiText("Cancelar")}</Button>
              <Button type="submit" variant="primary">{uiText("Salvar assistente")}</Button>
            </div>
          </form>
        ) : (
          <>
            {error && <p role="alert" className="text-caption text-danger">{error}</p>}
            <div className="flex justify-end">
              <Button icon={<Plus size={14} />} onClick={() => { setError(null); setDraft(blank); }}>{uiText("Novo assistente")}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
