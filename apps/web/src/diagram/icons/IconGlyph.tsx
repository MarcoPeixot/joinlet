import { uiText } from '../../i18n';
import type { Theme } from '../../ui/theme';
import { legibleBrandColor } from '../palette';
import { useIcon } from './useIcon';

interface IconGlyphProps {
  name: string;
  size: number;
  color?: string;
  /** Paints a brand mark with `color` instead of its own when that one would vanish on this theme. */
  legibleOn?: Theme;
}

/** Icon bodies come from bundled icon data, never from user input. */
export function IconGlyph({ name, size, color = 'currentColor', legibleOn }: IconGlyphProps) {
  const icon = useIcon(name);
  if (icon === undefined) return <span style={{ width: size, height: size, flex: 'none' }} />;
  if (icon === null) {
    return (
      <span className="strukt-icon-missing" style={{ width: size, height: size }} title={uiText("Ícone desconhecido: {0}", [name])}>
        ?
      </span>
    );
  }
  const stroke = icon.mode === 'stroke';
  const brand = icon.color && legibleOn ? legibleBrandColor(icon.color, legibleOn) : icon.color;
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill={stroke ? 'none' : icon.mode === 'fill' ? (brand ?? color) : undefined}
      stroke={stroke ? color : undefined}
      strokeWidth={stroke ? 1.75 : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: legibleOn === 'dark' && icon.darkBody ? icon.darkBody : icon.body }}
    />
  );
}
