import { Languages } from 'lucide-react';
import { useState } from 'react';
import { changeLocale, getLocale, systemMessage, type Locale } from './index';
import './language.css';

export function LanguagePicker() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const en = getLocale() === 'en';
  return <span className="joinlet-language">
    <Languages size={15} aria-hidden />
    <select aria-label={en ? 'Language' : 'Idioma'} value={getLocale()} disabled={busy} onChange={async event => {
      const next = event.target.value as Locale;
      setBusy(true); setError(null);
      try { await changeLocale(next); } catch (cause) { setError(cause instanceof Error ? systemMessage(cause.message) : (en ? 'Could not save changes. Try again.' : 'Não foi possível salvar as mudanças. Tente novamente.')); setBusy(false); }
    }}>
      <option value="pt-BR">PT-BR</option><option value="en">EN</option>
    </select>
    {error && <span role="alert">{error}</span>}
  </span>;
}
