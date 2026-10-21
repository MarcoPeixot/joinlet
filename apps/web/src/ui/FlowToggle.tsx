import { uiText } from '../i18n';
import { Activity } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './IconButton';
import { toggleFlowAnimation, useUi } from './uiStore';

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** "Animar fluxo" on the Overview toolbar (the packets themselves are hidden by CSS under reduced motion). */
export function FlowToggle({ children, tooltipSide }: { children?: ReactNode; tooltipSide?: 'top' | 'right' | 'bottom' | 'left' }) {
  const on = useUi((s) => s.flowAnimation);
  return (
    <IconButton
      label={uiText("Animar fluxo")}
      title={reducedMotion() ? uiText("Animar fluxo — pausado: o sistema pede menos movimento") : uiText("Animar fluxo")}
      pressed={on}
      tooltipSide={tooltipSide}
      onClick={toggleFlowAnimation}
    >
      <Activity />
      {children}
    </IconButton>
  );
}
