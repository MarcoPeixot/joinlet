import { ViewportPortal } from '@xyflow/react';
import { useUi } from '../ui/uiStore';

export function HelperLines() {
  const guides = useUi((s) => s.guides);
  if (!guides.length) return null;
  return (
    <ViewportPortal>
      <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 2000 }} width={1} height={1}>
        {guides.map((g, i) =>
          g.axis === 'x' ? (
            <line key={i} x1={g.pos} x2={g.pos} y1={g.from - 12} y2={g.to + 12} stroke="var(--sk-accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          ) : (
            <line key={i} x1={g.from - 12} x2={g.to + 12} y1={g.pos} y2={g.pos} stroke="var(--sk-accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          ),
        )}
      </svg>
    </ViewportPortal>
  );
}
