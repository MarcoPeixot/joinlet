import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authText as uiText } from './messages';
import { authFieldClass, authRequest } from './client';
import { Button } from '../ui/Button';

type Profile = { id: number; name: string; email: string | null; avatar: string | null };

async function readAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw Error(uiText('Escolha uma imagem PNG, JPG ou WebP de até 2 MB.'));
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw Error(uiText('Não foi possível abrir esta imagem. Escolha outro arquivo.')); }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx || !bitmap.width || !bitmap.height) throw Error(uiText('Não foi possível abrir esta imagem. Escolha outro arquivo.'));
    const size = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 128, 128);
    return canvas.toDataURL('image/png');
  } finally { bitmap.close(); }
}

export function AccountProfile({ csrf }: { csrf: string }) {
  const [profile, setProfile] = useState<Profile | null>(null), [name, setName] = useState(''), [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [saved, setSaved] = useState(false), [retry, setRetry] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void authRequest<Profile>('me').then(value => { if (active) { setProfile(value); setName(value.name); setAvatar(value.avatar); } }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const value = await authRequest<Profile>('profile', { name, avatar }, csrf);
      setProfile(value); setName(value.name); setAvatar(value.avatar); setSaved(true);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <section className="mt-4 border-t border-line pt-4" aria-label={uiText('Seu perfil')}>
    <h3 className="font-medium">{uiText('Seu perfil')}</h3>
    {loading ? <p role="status" className="mt-3 text-caption text-muted">{uiText('Aguarde…')}</p> : profile ? <>
      {!open && <div className="mt-3 flex flex-wrap items-center gap-3">{profile.avatar ? <img src={profile.avatar} alt={uiText('Foto do perfil')} width={40} height={40} className="h-10 w-10 rounded-full object-cover"/> : <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-bg text-accent">{profile.name.slice(0, 1).toUpperCase()}</span>}<div className="min-w-0 flex-1"><p className="text-body break-words">{profile.name}</p><p className="text-caption text-muted break-all">{profile.email}</p></div></div>}
      <Button variant="ghost" disabled={busy} aria-expanded={open} onClick={() => { setOpen(!open); setName(profile.name); setAvatar(profile.avatar); setError(''); setSaved(false); }}>{uiText(open ? 'Fechar edição do perfil' : 'Editar perfil')}</Button>
      {open && <form onSubmit={event => void submit(event)} aria-label={uiText('Seu perfil')} className="mt-3 flex max-w-md flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {avatar ? <img src={avatar} alt={uiText('Foto do perfil')} width={64} height={64} className="h-16 w-16 rounded-full object-cover"/> : <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-bg text-xl text-accent">{(name || '?').slice(0, 1).toUpperCase()}</span>}
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => file.current?.click()}>{uiText('Escolher foto')}</Button>{avatar && <Button disabled={busy} variant="ghost" onClick={() => { setAvatar(null); setSaved(false); }}>{uiText('Remover foto')}</Button>}</div>
        <input ref={file} aria-label={uiText('Enviar foto do perfil')} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={event => {
          const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return;
          setBusy(true); setError(''); setSaved(false);
          void readAvatar(selected).then(setAvatar).catch(cause => setError(cause.message)).finally(() => setBusy(false));
        }}/>
      </div>
      <p className="text-caption text-muted">{uiText('Seu nome e foto identificam você. PNG, JPG ou WebP, até 2 MB.')}</p>
      <label className="text-body">{uiText('Nome de exibição')}<input className={authFieldClass} required maxLength={80} autoComplete="name" value={name} disabled={busy} onChange={event => { setName(event.target.value); setSaved(false); }}/></label>
      <div className="text-caption text-muted break-all">{profile.email && <p>{uiText('E-mail')}: {profile.email}</p>}<p>{uiText('Conta #{0}', [profile.id])}</p></div>
      <Button type="submit" variant="primary" disabled={busy || (name === profile.name && avatar === profile.avatar)}>{uiText(busy ? 'Aguarde…' : 'Salvar perfil')}</Button>
      {saved && <p role="status" className="text-caption text-muted">{uiText('Perfil atualizado.')}</p>}
    </form>}</> : <Button onClick={() => setRetry(value => value + 1)}>{uiText('Tentar novamente')}</Button>}
    {error && <p role="alert" className="mt-3 text-caption text-danger">{error}</p>}
  </section>;
}
