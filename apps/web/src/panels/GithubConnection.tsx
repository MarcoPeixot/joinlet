import { uiText } from '../i18n';
import { CheckCircle2, ExternalLink, GitBranch, LoaderCircle, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useGithub } from '../github/session';
import { Button } from '../ui/Button';

const card = 'flex flex-col gap-3 rounded-panel border border-line bg-panel p-3';

interface AuthView {
  configured: boolean;
  connected: boolean;
  login: string | null;
}

interface DeviceFlow {
  id: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
}

export function GithubConnection({ onAuthChange }: { onAuthChange: (connected: boolean) => void }) {
  const [auth, setAuth] = useState<AuthView>({ configured: false, connected: false, login: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const store = useGithub((s) => s);

  useEffect(() => {
    let active = true;
    void fetch('/api/git/auth')
      .then(async (response) => ({ response, data: (await response.json().catch(() => ({}))) as AuthView & { error?: string } }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) setError(data.error ?? uiText("Não foi possível consultar a conta GitHub."));
        else {
          setAuth({ configured: data.configured === true, connected: data.connected === true, login: data.login ?? null });
          onAuthChange(data.connected === true);
        }
      })
      .catch(() => { if (active) setError(uiText("Servidor local indisponível. Inicie o app com bun run dev.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onAuthChange]);

  useEffect(() => {
    if (!flow) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/git/auth/device/${encodeURIComponent(flow.id)}`);
        const result = (await response.json().catch(() => ({}))) as { state?: string; retryAfter?: number; login?: string; error?: string };
        if (stopped) return;
        if (!response.ok || result.state === 'error') {
          setError(result.error ?? uiText("Não foi possível concluir o login com GitHub."));
          setFlow(null);
        } else if (result.state === 'connected' && result.login) {
          setAuth({ configured: true, connected: true, login: result.login });
          onAuthChange(true);
          setFlow(null);
          void store.refresh();
        } else {
          timer = setTimeout(() => void poll(), Math.max(result.retryAfter ?? flow.intervalSeconds, 1) * 1000);
        }
      } catch {
        if (!stopped) {
          setError(uiText("Não foi possível verificar o login. Confira se o servidor local continua rodando."));
          setFlow(null);
        }
      }
    };
    timer = setTimeout(() => void poll(), Math.max(flow.intervalSeconds, 1) * 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [flow, onAuthChange, store]);

  const startLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/git/auth/device', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = (await response.json().catch(() => ({}))) as DeviceFlow & { error?: string };
      if (!response.ok || !data.id || !data.userCode || !data.verificationUri) {
        setError(data.error ?? uiText("Não foi possível iniciar o login com GitHub."));
        return;
      }
      setFlow({ id: data.id, userCode: data.userCode, verificationUri: data.verificationUri, intervalSeconds: data.intervalSeconds ?? 5 });
    } catch {
      setError(uiText("Servidor local indisponível. Inicie o app com bun run dev."));
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/git/auth/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = (await response.json().catch(() => ({}))) as AuthView & { error?: string };
      if (!response.ok) setError(data.error ?? uiText("Não foi possível desconectar a conta."));
      else {
        setAuth({ configured: data.configured === true, connected: data.connected === true, login: data.login ?? null });
        onAuthChange(data.connected === true);
      }
      setFlow(null);
      void store.refresh();
    } catch {
      setError(uiText("Servidor local indisponível. Inicie o app com bun run dev."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {auth.connected ? <CheckCircle2 size={17} className="text-(--sk-diff-added)" /> : <GitBranch size={17} className="text-muted" />}
          <div className="min-w-0">
            <h2 className="text-title font-semibold">{uiText("1. Conta GitHub")}</h2>
            <p className="mt-0.5 text-caption text-muted">
              {loading ? uiText("Verificando conexão…") : auth.connected ? uiText("Conectado como @{0}", [auth.login]) : auth.configured ? uiText("Entre para publicar branches e pull requests.") : uiText("Login indisponível até configurar o OAuth no servidor.")}
            </p>
          </div>
        </div>
        {auth.connected ? (
          <Button variant="secondary" size="sm" disabled={loading} icon={<LogOut size={14} />} onClick={() => void disconnect()}>{uiText("Sair deste computador")}</Button>
        ) : !flow && auth.configured ? (
          <Button variant="secondary" disabled={loading} icon={loading ? <LoaderCircle size={14} className="animate-spin" /> : <GitBranch size={14} />} onClick={() => void startLogin()}>{uiText("Conectar com GitHub")}</Button>
        ) : null}
      </div>
      {!auth.configured && !loading && !error && (
        <details className="rounded-control bg-panel-2 p-3 text-caption leading-relaxed text-muted">
          <summary className="cursor-pointer font-medium text-ink">{uiText("Configurar OAuth (servidor)")}</summary>
          <p className="mt-2">{uiText("Crie um OAuth App, ative")} <code>Device Flow</code> {uiText("e configure apenas o Client ID em")} <code>STRUKT_GITHUB_CLIENT_ID</code> {uiText("no servidor. Reinicie o Joinlet depois.")}</p>
          <a className="mt-2 inline-flex items-center gap-1 font-medium text-accent hover:underline" href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer">{uiText("Configurações de desenvolvedor do GitHub")} <ExternalLink size={12} />
          </a>
        </details>
      )}
      {auth.configured && !auth.connected && !flow && !loading && (
        <p className="text-caption leading-relaxed text-muted">{uiText("O escopo")} <code>repo</code> {uiText("autoriza leitura e escrita completas em repositórios públicos e privados da conta, além de recursos relacionados.")} <code>offline_access</code> {uiText("permite renovar a sessão. O Joinlet publica")} <code>{".arch/"}</code> {uiText("e os arquivos de configuração MCP da pasta escolhida, mas o token concede o escopo")} <code>repo</code> {uiText("à conta toda.")}</p>
      )}
      {flow && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-panel-2 p-3">
          <div>
            <p className="text-caption text-muted">{uiText("Digite este código na página segura do GitHub")}</p>
            <p className="mt-1 font-mono text-heading font-semibold tracking-[0.12em] text-ink">{flow.userCode}</p>
          </div>
          <a className="inline-flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 text-body font-medium text-accent-ink hover:brightness-110" href={flow.verificationUri} target="_blank" rel="noopener noreferrer">{uiText("Abrir GitHub")} <ExternalLink size={13} />
          </a>
        </div>
      )}
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
      {auth.connected && (
        <p className="text-caption leading-relaxed text-muted">{uiText("Sair remove o token deste computador. Para revogar a autorização da conta, use as")} <a className="text-accent hover:underline" href="https://github.com/settings/connections/applications" target="_blank" rel="noopener noreferrer">{uiText("configurações do GitHub")}</a>.
        </p>
      )}
    </section>
  );
}
