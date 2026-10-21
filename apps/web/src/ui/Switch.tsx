import { Switch as RSwitch } from 'radix-ui';
import { useId } from 'react';

interface SwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** A setting that is on or off: title and hint on the left, the switch on the right (the whole row is clickable). */
export function Switch({ label, description, checked, onChange }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-4 py-2.5">
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5">
        <span className="text-body font-medium">{label}</span>
        {description && <span className="text-caption leading-relaxed text-muted">{description}</span>}
      </label>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-[22px] w-[38px] flex-none cursor-pointer rounded-full border border-line-strong bg-panel-3 outline-none transition-colors duration-(--sk-motion) ease-sk focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:border-transparent data-[state=checked]:bg-accent-strong"
      >
        <RSwitch.Thumb className="block h-4 w-4 translate-x-[2px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-(--sk-motion) ease-sk data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-ink" />
      </RSwitch.Root>
    </div>
  );
}
