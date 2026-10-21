import { appUrl } from '../ui/urls';
import { useState } from "react";
import { Cloud, LogOut } from "lucide-react";
import { Button } from "../ui/Button";
import { uiText } from "../i18n";
import { collaborationSession } from "../workspace/boot";
import { workspace } from "../workspace/appWorkspace";

export function CloudAccount() {
  const session = collaborationSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (session?.mode !== "cloud") return null;
  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      await workspace.flush();
      const response = await fetch("/api/remote/disconnect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-strukt-csrf": session.csrf,
        },
        body: "{}",
      });
      if (!response.ok) throw Error(uiText("Não foi possível desconectar."));
      location.assign(appUrl());
    } catch (error) {
      setError(String((error as Error).message));
      setBusy(false);
    }
  };
  return (
    <div className="mb-6 rounded-panel border border-line bg-panel p-4">
      <div className="flex items-center gap-3">
        <Cloud size={20} className="text-accent" />
        <div className="flex-1">
          <p className="font-medium">Joinlet Cloud</p>
          <p className="text-caption text-muted">
            {uiText(
              session.owner
                ? "Seu workspace é salvo online. Suas chaves de IA são pessoais e criptografadas."
                : "Você está participando por um link compartilhado.",
            )}
          </p>
        </div>
        <Button
          disabled={busy}
          icon={<LogOut size={14} />}
          onClick={() => void leave()}
        >
          {uiText(session.owner ? "Sair da conta" : "Sair do workspace")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
