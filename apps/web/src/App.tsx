import { LazyMotion, MotionConfig } from 'motion/react';
import { AppShell } from './app/AppShell';
import { TooltipLayer } from './ui/Tooltip';
import { useUi } from './ui/uiStore';
import { AnalyticsConsent } from './analytics/AnalyticsConsent';

const loadFeatures = () => import('./ui/motionFeatures').then((mod) => mod.default);

export function App() {
  const reduce = useUi((s) => s.reduceMotion);
  return (
    // Under "reduce motion" (the OS's, or Configurações' own) the app keeps its fades but nothing slides or scales.
    <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>
      <LazyMotion features={loadFeatures} strict>
        <AppShell />
        <AnalyticsConsent />
        <TooltipLayer />
      </LazyMotion>
    </MotionConfig>
  );
}
