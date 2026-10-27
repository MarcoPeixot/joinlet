import { uiText } from '../i18n';
import { Button } from '../ui/Button';
import { showToast } from '../ui/uiStore';
import { signInToCloud } from '../workspace/boot';

export function CloudSignIn() {
  return <Button onClick={() => void signInToCloud().catch(error => showToast(String(error)))}>{uiText('Entrar na conta')}</Button>;
}

export function GuestCloudPrompt() {
  return <section className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4">
    <p className="text-body text-muted">{uiText('Você está usando o editor sem conta. Seu trabalho fica salvo neste navegador.')}</p>
    <p className="text-caption text-muted">{uiText('Entre na conta para salvar online, parear seu computador e usar seus provedores de IA.')}</p>
    <CloudSignIn />
  </section>;
}
