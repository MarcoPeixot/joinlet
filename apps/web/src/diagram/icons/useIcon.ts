import { useEffect, useReducer } from 'react';
import { loadIcon, peekIcon } from './registry';
import type { IconDef } from './registry';

export function useIcon(name: string | undefined): IconDef | null | undefined {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const cached = name ? peekIcon(name) : null;
  useEffect(() => {
    if (!name || cached !== undefined) return;
    let alive = true;
    void loadIcon(name).then(() => {
      if (alive) rerender();
    });
    return () => {
      alive = false;
    };
  }, [name, cached]);
  return cached;
}
