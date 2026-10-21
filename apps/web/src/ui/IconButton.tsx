import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { labelParts } from './shortcut';
import { Tooltip } from './Tooltip';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'children'> {
  label: string;
  active?: boolean;
  /** A toggle: sets `aria-pressed` and shows the active look while on. */
  pressed?: boolean;
  /** Tooltip, when it should say more than the accessible `label`; a trailing "(⌘G)" becomes key caps. */
  title?: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Size in px of the icon inside (16 by default); its stroke is always 1.5. */
  iconSize?: 12 | 14 | 16;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

/** Class (not an inline style: sanitized surfaces assert there are none) for the icon inside. */
const ICON_SIZE = { 12: '[&_svg]:size-3', 14: '[&_svg]:size-3.5', 16: '[&_svg]:size-4' } as const;

export function IconButton({ label, active, pressed, title, tooltipSide, iconSize = 16, ref, className = '', children, ...rest }: IconButtonProps) {
  const { text, shortcut } = labelParts(title ?? label);
  const on = active || pressed;
  return (
    <Tooltip content={text} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={`inline-flex h-8 min-w-8 items-center pointer-coarse:min-h-10 pointer-coarse:min-w-10 justify-center gap-1.5 rounded-control px-2 text-body transition-[background-color,color] duration-(--sk-motion-fast) ease-sk ${ICON_SIZE[iconSize]} [&_svg]:stroke-[1.5] disabled:opacity-35 disabled:hover:bg-transparent ${
          on ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel-2 hover:text-ink'
        } ${className}`}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
