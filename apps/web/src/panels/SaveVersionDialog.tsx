import { uiText } from '../i18n';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/controls';
import { Modal } from '../ui/Modal';
import { showToast } from '../ui/uiStore';
import { useVersions, versionStore } from '../versions/session';

const close = () => versionStore.getState().setDialogOpen(false);

/** ⌘S: names the version, then saves the open diagram (code + positions) under .arch/versions/. */
export function SaveVersionDialog() {
  const open = useVersions((s) => s.dialogOpen);
  return (
    <Modal open={open} onClose={close} label={uiText("Salvar versão")} icon={<Save size={16} />} placement="top" width={440}>
      <SaveVersionForm />
    </Modal>
  );
}

function SaveVersionForm() {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    const saved = await versionStore.getState().save(message);
    setSaving(false);
    if (!saved) return;
    close();
    showToast(uiText("Versão salva."));
  };
  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        autoFocus
        aria-label={uiText("Descrição da versão")}
        placeholder={uiText("Ex.: antes de separar pagamentos")}
        className={`${inputClass} h-9`}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <p className="text-caption text-muted">{uiText("Guarda o código e as posições deste diagrama em .arch/versions/. Nenhuma versão é apagada.")}</p>
      <div className="flex justify-end gap-2">
        <Button onClick={close}>{uiText("Cancelar")}</Button>
        <Button type="submit" variant="primary" disabled={saving}>{uiText("Salvar")}</Button>
      </div>
    </form>
  );
}
