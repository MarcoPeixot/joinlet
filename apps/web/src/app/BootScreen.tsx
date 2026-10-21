import { uiText } from '../i18n';
import { FolderOpen } from 'lucide-react';
import { m } from 'motion/react';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { POP } from '../ui/motion';
import { Toast } from '../ui/Toast';
import { bootWorkspace, reopenFolder, switchToBrowserStorage } from '../workspace/boot';
import type { BootPhase } from '../workspace/boot';
import { showProjects } from '../workspace/catalog';

/** Shown until the workspace is open: loading, the "Reabrir pasta" banner (spec §11) or a failure. */
export function BootScreen({ phase }: { phase: Exclude<BootPhase, { kind: 'ready' }> }) {
  return (
    <div className="relative flex h-full items-center justify-center bg-canvas">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <m.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
          <Logo size={40} />
        </m.div>
        {phase.kind === 'loading' && <p className="sk-shimmer font-medium">{uiText("Abrindo workspace…")}</p>}
        {phase.kind === 'needs-remote-auth' && (
          <div className="flex flex-col items-center gap-4 rounded-[18px] p-6">
            <h1 className="text-heading font-semibold">{uiText("Seu workspace, sempre com você")}</h1>
            <p className="leading-relaxed text-muted">{uiText("Entre com GitHub para criar seu workspace gratuito. Você não precisa conectar um repositório para começar.")}</p>
            <Button variant="primary" onClick={() => { location.assign('/auth/login'); }}>{uiText("Continuar com GitHub")}</Button>
            <details className="text-caption text-muted"><summary>{uiText("Conectar um agente MCP")}</summary><code className="mt-3 block break-all">{phase.mcpUrl}</code><Button onClick={() => void bootWorkspace()}>{uiText("Já autorizei, abrir workspace")}</Button></details>
          </div>
        )}
        {phase.kind === 'failed' && (
          <m.div role="alert" className="sk-float flex flex-col items-center gap-4 rounded-[18px] p-6" {...POP}>
            <p className="text-danger">{phase.message}</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void bootWorkspace()}>{uiText("Tentar de novo")}</Button>
              {!phase.remote && <><Button onClick={() => void switchToBrowserStorage()}>{uiText("Usar o navegador")}</Button><Button onClick={showProjects}>{uiText("Meus projetos")}</Button></>}
            </div>
          </m.div>
        )}
        {phase.kind === 'needs-permission' && (
          <m.div role="alert" className="sk-float flex flex-col items-center gap-4 rounded-[18px] p-6" {...POP}>
            <p className="leading-relaxed">{uiText("O navegador precisa da sua permissão para abrir de novo a pasta")} <strong>{phase.folder}</strong>.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" icon={<FolderOpen size={14} />} onClick={() => void reopenFolder()}>{uiText("Reabrir pasta")}</Button>
              <Button onClick={() => void switchToBrowserStorage()}>{uiText("Usar o navegador")}</Button>
              <Button onClick={showProjects}>{uiText("Meus projetos")}</Button>
            </div>
          </m.div>
        )}
      </div>
      <Toast />
    </div>
  );
}
