import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { authText as uiText } from './messages';
import { Button } from '../ui/Button';
import { BrowserDraftBackup } from './BrowserDraftBackup';
import { authFieldClass, authRequest } from './client';
import { allowsOptionalLogin } from '../settings/publicAccess';
import { continueWithoutAccount } from '../workspace/boot';

export function AuthForm({ mcpUrl }: { mcpUrl: string }) {
  const [methods, setMethods] = useState<{ password: boolean; github: boolean } | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => { setError(''); void authRequest<{ password: boolean; github: boolean }>('config').then(setMethods).catch(error => setError(error.message)); };
  useEffect(load, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (mode === 'register' && password !== confirmation) { setError(uiText('As senhas não coincidem.')); return; }
    setBusy(true);
    try {
      if (mode === 'register') await authRequest('register', { email, password });
      await authRequest('login', { email, password });
      setPassword(''); setConfirmation('');
      await (await import('../workspace/boot')).bootWorkspace();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="flex w-full flex-col items-center gap-5 text-left">
    <div className="text-center">
      <h1 className="text-heading font-semibold">{uiText(mode === 'login' ? 'Seu workspace, sempre com você' : 'Crie sua conta Joinlet')}</h1>
      <p className="mt-2 text-body leading-relaxed text-muted">{uiText('Entre com e-mail e senha para salvar seu workspace online.')}</p>
    </div>
    {!methods && !error && <p role="status" className="text-caption text-muted">{uiText('Carregando…')}</p>}
    {methods?.password && <form aria-label={uiText(mode === 'login' ? 'Entrar na conta' : 'Criar conta')} className="flex w-full flex-col gap-4" onSubmit={event => void submit(event)}>
      <label className="flex flex-col gap-1.5 text-body">{uiText('E-mail')}<input className={authFieldClass} type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>
      <label className="flex flex-col gap-1.5 text-body">{uiText('Senha')}<input className={authFieldClass} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={15} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} aria-describedby={mode === 'register' ? 'password-help' : undefined} /></label>
      {mode === 'register' && <>
        <label className="flex flex-col gap-1.5 text-body">{uiText('Confirmar senha')}<input className={authFieldClass} type="password" autoComplete="new-password" required minLength={15} maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></label>
        <p id="password-help" className="text-caption leading-relaxed text-muted">{uiText('Use de 15 a 128 caracteres. Guarde sua senha: a recuperação por e-mail ainda não está disponível.')}</p>
      </>}
      <Button variant="primary" type="submit" className="w-full" disabled={busy}>{uiText(busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta')}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setPassword(''); setConfirmation(''); }}>{uiText(mode === 'login' ? 'Criar uma conta' : 'Já tenho uma conta')}</Button>
    </form>}
    {error && <p role="alert" className="text-body text-danger">{error}</p>}
    {!methods && error && <Button onClick={load}>{uiText('Tentar de novo')}</Button>}
    {methods?.github && <>
      <Button onClick={() => location.assign('/auth/login')}>{uiText('Continuar com GitHub')}</Button>
      <details className="w-full text-caption text-muted"><summary>{uiText('Conectar um agente MCP')}</summary><code className="mt-3 block break-all">{mcpUrl}</code><Button onClick={() => void import('../workspace/boot').then(module => module.bootWorkspace())}>{uiText('Já autorizei, abrir workspace')}</Button></details>
    </>}
    {allowsOptionalLogin() && <Button variant="secondary" disabled={busy} onClick={continueWithoutAccount}>{uiText('Continuar sem conta')}</Button>}
    <BrowserDraftBackup />
  </div>;
}
