import { useState } from 'react';
import { Check, Copy, RefreshCw, ServerOff } from 'lucide-react';
import { uiText, getLocale } from '../i18n';
import { Button } from '../ui/Button';
import { closeSettings, refreshSettings } from './store';
import { isBrowserPreview } from './publicAccess';

/** An unavailable API must explain how to get started, not leave users at a retry button. */
export function AiSetupGuide({ error }: { error: string | null }) {
  const preview = isBrowserPreview();
  const [copied, setCopied] = useState(false);
  const hosted = document.querySelector('meta[name="strukt-mode"]')?.getAttribute('content') === 'remote';
  const command = 'git clone https://github.com/MarcoPeixot/joinlet.git\ncd joinlet\nbun install --frozen-lockfile\nbun run dev';
  return <section className="sk-ai-setup" aria-labelledby="ai-setup-title">
    <ServerOff size={26} aria-hidden />
    <h3 id="ai-setup-title">{uiText(preview ? 'A IA não está habilitada nesta prévia' : hosted ? 'O serviço de IA está indisponível' : 'Prepare sua conexão de IA')}</h3>
    <p>{uiText(preview ? 'Esta prévia salva seu trabalho no navegador e não oferece o serviço de IA. Para configurar um provedor com sua chave, execute o Joinlet localmente seguindo os passos abaixo.' : hosted ? 'Tente reconectar. Se o serviço continuar indisponível, fale com quem administra este workspace.' : 'Você já pode desenhar e salvar no navegador. Para conversar com a IA, use o Joinlet com seu servidor local e um provedor conectado.')}</p>
    {!hosted && <>
      <ol>
        <li><strong>{uiText('Inicie o Joinlet no computador')}</strong><p>{uiText('Na pasta do projeto Joinlet, execute os comandos abaixo. Precisa preparar o ambiente? Consulte o guia de instalação.')}</p>
          <div className="sk-setup-command"><pre>{command}</pre><button type="button" aria-label={uiText('Copiar comandos de instalação')} onClick={() => { void navigator.clipboard.writeText(command).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
          <a href={`/setup/?lang=${getLocale()}`} target="_blank" rel="noopener noreferrer">{uiText('Guia de instalação')}</a>
        </li>
        <li><strong>{uiText('Abra o editor local')}</strong><p>{uiText('Acesse o endereço abaixo no mesmo computador. O workspace deste site continua salvo neste navegador; use a exportação ZIP para levá-lo ao editor local.')}</p><a href="http://localhost:5178/app/" target="_blank" rel="noopener noreferrer">localhost:5178/app/</a></li>
        <li><strong>{uiText('Conecte e teste seu provedor')}</strong><p>{uiText('Em Configurações → IA e providers, escolha o serviço, salve sua chave e teste a conexão. Ollama e LM Studio também são compatíveis.')}</p></li>
      </ol>
    </>}
    <div className="flex flex-wrap gap-2">{!preview && <Button icon={<RefreshCw size={14} />} onClick={() => void refreshSettings()}>{uiText('Tentar de novo')}</Button>}<Button variant="ghost" onClick={closeSettings}>{uiText('Continuar no editor')}</Button></div>
    {error && <details className="sk-setup-diagnostic"><summary>{uiText('Detalhes da conexão')}</summary><p>{error}</p></details>}
    <span className="sr-only" role="status">{copied ? uiText('Copiado') : ''}</span>
  </section>;
}
