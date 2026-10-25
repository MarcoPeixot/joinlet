import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { uiText } from '../i18n';
import { Button } from './Button';
import { showToast } from './uiStore';

/** Selectable text and an explicit copy action, including browsers without Clipboard API access. */
export function CopyCode({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      try { await navigator.clipboard.writeText(text); }
      catch {
        const area = document.createElement('textarea');
        area.value = text; area.style.cssText = 'position:fixed;opacity:0;left:-9999px';
        document.body.append(area);
        try { area.select(); if (!document.execCommand('copy')) throw Error('Copy unavailable'); }
        finally { area.remove(); }
      }
      setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2000);
    } catch { showToast(uiText('Não foi possível copiar.')); }
  };
  return <div className="flex min-w-0 flex-col gap-1 rounded-control bg-panel-2 p-2">
    <div className="flex justify-end"><Button size="sm" variant="ghost" aria-label={label} icon={copied ? <Check size={14}/> : <Copy size={14}/>} onClick={() => void copy()}>{copied ? uiText('Copiado.') : uiText('Copiar')}</Button></div>
    <pre className="m-0 min-w-0 whitespace-pre-wrap break-all font-mono text-caption" style={{userSelect:'text',WebkitUserSelect:'text'}} onPointerDown={event=>event.stopPropagation()}><code>{text}</code></pre>
  </div>;
}
