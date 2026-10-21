import { uiText } from '../i18n';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { checkStageMeta } from '@strukt/workspace';
import { Button } from '../ui/Button';
import { Field, FieldGroup, Segmented, inputClass } from '../ui/controls';
import { Modal } from '../ui/Modal';
import { showToast } from '../ui/uiStore';
import { useVersions, versionStore } from '../versions/session';

const close = () => versionStore.getState().setPlanDialogOpen(false);

/** "Planejar estado futuro": saves the open diagram as a planned (or transition) version with an optional goal date. */
export function PlanFutureDialog() {
  const open = useVersions((s) => s.planDialogOpen);
  return (
    <Modal open={open} onClose={close} label={uiText("Planejar estado futuro")} icon={<CalendarClock size={16} />} placement="top" width={460}>
      <PlanFutureForm />
    </Modal>
  );
}

function PlanFutureForm() {
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<'planejado' | 'transição'>('planejado');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    const checked = checkStageMeta(stage, target);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    setSaving(true);
    const saved = await versionStore.getState().save(message.trim() || (stage === 'planejado' ? uiText("Estado planejado") : uiText("Estado de transição")), 'human', checked.meta);
    setSaving(false);
    if (!saved) return;
    close();
    showToast(stage === 'planejado' ? uiText("Estado planejado salvo.") : uiText("Estado de transição salvo."));
  };
  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label={uiText("Descrição")}>
        <input autoFocus aria-label={uiText("Descrição do estado")} placeholder={uiText("Ex.: sem o monolito de pedidos")} className={`${inputClass} h-9`} value={message} onChange={(event) => setMessage(event.target.value)} />
      </Field>
      <FieldGroup label={uiText("Estágio")}>
        <Segmented
          value={stage}
          onChange={setStage}
          options={[
            { value: 'planejado', label: uiText("Planejado"), title: uiText("O estado que se quer alcançar") },
            { value: 'transição', label: uiText("Transição"), title: uiText("Um passo intermediário no caminho") },
          ]}
        />
      </FieldGroup>
      <Field label={uiText("Meta (opcional)")}>
        <input type="date" aria-label={uiText("Meta")} className={`${inputClass} h-9`} value={target} onChange={(event) => setTarget(event.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
      <p className="text-caption text-muted">{uiText("Guarda o diagrama aberto como um estado futuro em .arch/versions/. O diagrama continua como está: para voltar a um estado atual, aplique uma versão na linha do tempo.")}</p>
      <div className="flex justify-end gap-2">
        <Button onClick={close}>{uiText("Cancelar")}</Button>
        <Button type="submit" variant="primary" disabled={saving}>{uiText("Planejar")}</Button>
      </div>
    </form>
  );
}
