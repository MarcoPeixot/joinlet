import { Check } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { Keys } from './Kbd';

interface MenuProps {
  trigger: ReactElement;
  label: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

/** A dropdown of actions (arrow keys, type-ahead, Escape); items are `MenuItem`s. */
export function Menu({ trigger, label, align = 'end', side = 'bottom', children }: MenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="sk-pop sk-elev-2 sk-anim-pop z-[60] min-w-52 rounded-[12px] p-1 outline-none"
          style={{ transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)' }}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  shortcut?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}

export function MenuItem({ icon, shortcut, hint, danger, disabled, onSelect, children }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex h-8 pointer-coarse:h-10 cursor-default select-none items-center gap-2.5 rounded-[8px] px-2 text-body outline-none transition-colors duration-(--sk-motion-fast) data-disabled:opacity-40 data-highlighted:bg-panel-2 ${
        danger ? 'text-danger' : 'text-ink'
      }`}
    >
      {icon && <span className={`flex w-4 justify-center ${danger ? '' : 'text-muted'}`}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-caption text-faint">{hint}</span>}
      {shortcut && <Keys combo={shortcut} />}
    </DropdownMenu.Item>
  );
}

interface MenuCheckItemProps {
  icon?: ReactNode;
  checked: boolean;
  /** A second, quieter line under the label. */
  description?: string;
  hint?: string;
  onSelect: () => void;
  children: ReactNode;
}

/** A toggle in a menu (`menuitemcheckbox`): the checked one gets the accent and a check mark. */
export function MenuCheckItem({ icon, checked, description, hint, onSelect, children }: MenuCheckItemProps) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onSelect={onSelect}
      className="flex min-h-8 pointer-coarse:min-h-10 cursor-default select-none items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-body text-ink outline-none transition-colors duration-(--sk-motion-fast) data-highlighted:bg-panel-2"
    >
      {icon && <span className={`flex w-4 flex-none justify-center ${checked ? 'text-accent' : 'text-muted'}`}>{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate ${checked ? 'font-medium text-accent' : ''}`}>{children}</span>
        {description && <span className="truncate text-caption text-faint">{description}</span>}
      </span>
      {hint && <span className="text-caption text-faint">{hint}</span>}
      <DropdownMenu.ItemIndicator className="flex text-accent">
        <Check size={14} />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.CheckboxItem>
  );
}

/** Items that belong together, named for assistive tech by `label` (shown as the group's heading). */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Group aria-label={label}>
      <MenuLabel>{label}</MenuLabel>
      {children}
    </DropdownMenu.Group>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="mx-1 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-caption font-medium text-muted">{children}</DropdownMenu.Label>;
}
