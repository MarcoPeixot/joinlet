import { uiText } from '../i18n';
/** Configurações › Geral › Cor de destaque: overrides only the `--sk-accent*` tokens (styles/app.css). */
export type Accent = 'lime' | 'cobalt' | 'signal' | 'iris' | 'emerald' | 'amber' | 'graphite';

export const ACCENTS: readonly Accent[] = ['lime', 'cobalt', 'signal', 'iris', 'emerald', 'amber', 'graphite'];

export const ACCENT_LABEL: Record<Accent, string> = { lime: uiText("Lima · Joinlet"), cobalt: uiText("Cobalto"), signal: uiText("Sinal"), iris: uiText("Íris"), emerald: uiText("Esmeralda"), amber: uiText("Âmbar"), graphite: uiText("Grafite") };

/** A saved value (or anything else) to a known accent; Lima (the Joinlet brand) is the default. */
export function resolveAccent(saved: string | null | undefined): Accent {
  return ACCENTS.find((accent) => accent === saved) ?? 'lime';
}

/** Stable swatches show the palette before it is selected. */
export const ACCENT_SWATCH: Record<Accent, string> = { lime: "#a3ff3d", cobalt: "#4c8dff", signal: "#f76b3c", iris: "#9585f4", emerald: "#43be95", amber: "#efb64e", graphite: "#9299aa" };
