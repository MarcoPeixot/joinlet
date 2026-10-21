import { uiText } from '../i18n';
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { TOUR_STEPS, nextTourStep, stopTour, useTour } from './tour';

type Box = { left: number; top: number; width: number; height: number };

function measure(target: string): Box | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  const rect = el?.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  // A target as large as the canvas is pointed at from its middle, not from its (offscreen) edge.
  if (rect.width * rect.height > (window.innerWidth * window.innerHeight) / 3) return { left: rect.left + rect.width / 2, top: rect.top + rect.height / 2, width: 0, height: 0 };
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Non-blocking coach mark: a `Popover` whose trigger is an invisible box laid over the `data-tour` target. */
export function TourPopover() {
  const step = useTour((s) => s.step);
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (step === null) return;
    const target = TOUR_STEPS[step]!.target;
    const update = () => setBox(measure(target));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [step]);
  useEffect(() => {
    // A target that is not on screen (closed panel, phone layout) is skipped, not shown floating.
    if (step !== null && box === null && !measure(TOUR_STEPS[step]!.target)) nextTourStep();
  }, [step, box]);
  if (step === null || !box) return null;
  const current = TOUR_STEPS[step]!;
  const last = step === TOUR_STEPS.length - 1;
  return (
    <Popover
      open
      onOpenChange={(open) => !open && stopTour()}
      label={`Tour: ${current.title}`}
      side={current.side}
      className="w-[280px] p-3"
      trigger={<span aria-hidden className="pointer-events-none fixed" style={box} />}
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-body font-semibold">{current.title}</h3>
        <p className="text-caption leading-relaxed text-muted">{current.text}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-meta text-faint">{step + 1} {uiText("de")} {TOUR_STEPS.length}</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={stopTour}>{uiText("Pular")}</Button>
            <Button size="sm" variant="primary" onClick={nextTourStep}>{last ? uiText("Concluir") : uiText("Próximo")}</Button>
          </div>
        </div>
      </div>
    </Popover>
  );
}
