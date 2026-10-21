import type { ReactNode } from 'react';
import { Button } from './Button';

export type Illustration = 'versions' | 'flows' | 'accuracy' | 'board' | 'docs';

const STROKE = { fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const line = { ...STROKE, stroke: 'var(--sk-line-strong, var(--sk-line))' };
const soft = { ...STROKE, stroke: 'var(--sk-line)', fill: 'var(--sk-accent-soft)' };

/** Line-art scenes, drawn with the same tokens as the chrome so they follow every theme. */
const SCENES: Record<Illustration, ReactNode> = {
  versions: (
    <>
      <path d="M20 14v52" {...line} strokeDasharray="3 4" />
      <circle cx="20" cy="18" r="6" {...soft} />
      <circle cx="20" cy="40" r="6" {...soft} />
      <circle cx="20" cy="62" r="6" {...line} strokeDasharray="2 3" />
      <rect x="36" y="12" width="44" height="12" rx="4" {...soft} />
      <rect x="36" y="34" width="34" height="12" rx="4" {...soft} />
      <rect x="36" y="56" width="40" height="12" rx="4" {...line} strokeDasharray="3 3" />
    </>
  ),
  flows: (
    <>
      <rect x="8" y="30" width="22" height="20" rx="5" {...soft} />
      <rect x="66" y="12" width="22" height="20" rx="5" {...soft} />
      <rect x="66" y="48" width="22" height="20" rx="5" {...soft} />
      <path d="M30 40h12c6 0 6-18 12-18h12" {...line} />
      <path d="M42 40c6 0 6 18 12 18h12" {...line} strokeDasharray="3 4" />
      <path d="M62 18l4 4-4 4" {...line} />
    </>
  ),
  accuracy: (
    <>
      <path d="M48 10l26 10v20c0 16-11 26-26 32C33 66 22 56 22 40V20z" {...soft} />
      <path d="M37 40l8 8 15-16" {...line} />
    </>
  ),
  board: (
    <>
      <rect x="10" y="12" width="34" height="26" rx="5" {...soft} />
      <rect x="52" y="12" width="34" height="20" rx="5" {...soft} />
      <rect x="10" y="46" width="24" height="22" rx="5" {...line} strokeDasharray="3 3" />
      <rect x="42" y="42" width="44" height="26" rx="5" {...soft} />
      <path d="M44 25h8M60 32v10" {...line} />
    </>
  ),
  docs: (
    <>
      <path d="M26 10h30l14 14v44a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" {...soft} />
      <path d="M56 10v14h14" {...line} />
      <path d="M32 38h28M32 48h28M32 58h16" {...line} />
    </>
  ),
};

interface EmptyStateProps {
  illustration: Illustration;
  title: string;
  text: string;
  /** The single primary call to action. */
  action?: { label: string; onClick: () => void; icon?: ReactNode };
  className?: string;
}

/** An empty list or panel: a small drawing, a title, one line of text and at most one primary action. */
export function EmptyState({ illustration, title, text, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center gap-2 px-4 py-8 text-center ${className}`}>
      <svg aria-hidden viewBox="0 0 96 80" width="96" height="80" className="mb-1">
        {SCENES[illustration]}
      </svg>
      <h3 className="text-body font-semibold">{title}</h3>
      <p className="max-w-[260px] text-caption leading-relaxed text-muted">{text}</p>
      {action && (
        <Button variant="primary" icon={action.icon} onClick={action.onClick} className="mt-1.5">
          {action.label}
        </Button>
      )}
    </div>
  );
}
