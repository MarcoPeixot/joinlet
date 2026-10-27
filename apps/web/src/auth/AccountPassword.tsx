import { useEffect, useState } from 'react';
import { isNewPassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_INPUT_LENGTH } from '@strukt/workspace/password-policy';
import type { FormEvent } from 'react';
import { authText as uiText } from './messages';
import { Button } from '../ui/Button';
import { appUrl } from '../ui/urls';
import { authFieldClass, authRequest } from './client';

export function AccountPassword({ csrf }: { csrf: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => { let active = true; void authRequest<{ password: boolean }>('me').then(value => { if (active) setAvailable(value.password); }).catch(() => {}); return () => { active = false; }; }, []);
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!isNewPassword(password)) { setError(uiText('Use uma senha de 8 a 128 caracteres, com pelo menos um caractere especial.')); return; }
    if (password !== confirmation) { setError(uiText('As senhas não coincidem.')); return; }
    setBusy(true);
    try {
      await (await import('../workspace/appWorkspace')).workspace.flush();
      await authRequest('change-password', { currentPassword, password }, csrf);
      setCurrent(''); setPassword(''); setConfirmation('');
      location.assign(appUrl());
    } catch (error) { setError((error as Error).message); setBusy(false); }
  };
  if (!available) return null;
  return <div className="mt-4 border-t border-line pt-3">
    <Button variant="ghost" onClick={() => { setOpen(!open); setCurrent(''); setPassword(''); setConfirmation(''); setError(''); }} disabled={busy} aria-expanded={open}>{uiText('Trocar senha')}</Button>
    {open && <form aria-label={uiText('Trocar senha')} onSubmit={event => void submit(event)} className="mt-3 flex max-w-sm flex-col gap-3">
      <label className="text-body">{uiText('Senha atual')}<input className={authFieldClass} required type="password" autoComplete="current-password" maxLength={PASSWORD_MAX_INPUT_LENGTH} value={currentPassword} onChange={event => setCurrent(event.target.value)} disabled={busy} /></label>
      <label className="text-body">{uiText('Nova senha')}<input className={authFieldClass} required type="password" autoComplete="new-password" aria-describedby="new-password-help" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_INPUT_LENGTH} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
      <label className="text-body">{uiText('Confirmar senha')}<input className={authFieldClass} required type="password" autoComplete="new-password" aria-describedby="new-password-help" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_INPUT_LENGTH} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></label>
      <p id="new-password-help" className="text-caption text-muted">{uiText('Use uma senha de 8 a 128 caracteres, com pelo menos um caractere especial.')}</p>
      <p className="text-caption text-muted">{uiText('Trocar a senha encerra suas sessões. Você precisará entrar novamente.')}</p>
      <Button type="submit" variant="primary" disabled={busy}>{uiText('Salvar nova senha')}</Button>
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
    </form>}
  </div>;
}
