import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

type Variant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-strong text-accent-ink hover:brightness-110',
  brand: 'bg-accent-strong text-accent-ink hover:brightness-110',
  secondary: 'bg-panel-2 text-ink hover:bg-panel-3',
  ghost: 'text-muted hover:bg-panel-2 hover:text-ink',
  danger: 'bg-danger-soft text-danger hover:bg-danger-soft',
};

export function Button({ variant = 'secondary', size = 'md', icon, type = 'button', ref, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex shrink-0 items-center justify-center pointer-coarse:min-h-10 gap-1.5 whitespace-nowrap rounded-control font-medium transition-[background-color,border-color,color,filter] duration-(--sk-motion-fast) ease-sk disabled:opacity-45 disabled:hover:brightness-100 ${
        size === 'sm' ? 'h-7 px-2.5 text-caption' : 'h-8 px-3 text-body'
      } ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
