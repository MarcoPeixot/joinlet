import type { CSSProperties } from 'react';
import type { PulseTrack } from './flowPulse';
import { PULSE_PERIOD, pulseLayers } from './flowPulse';

/**
 * "Animar fluxo" and the focus pulse: requests leave every PULSE_PERIOD and travel at one speed on every connection
 * (flowPulse.ts), each a comet: faint dashes sharing one head (`pulseLayers`), so the light fades from a bright
 * head to a soft tail, exactly as wide as the line, with square ends. One CSS animation per dash (`sk-flow-pulse`
 * in diagram.css): no per-frame React or style work.
 */
export function FlowPulses({ tracks, color, width }: { tracks: readonly PulseTrack[]; color: string; width: number }) {
  return (
    <g className="strukt-flow" aria-hidden>
      {tracks.flatMap((track, i) => {
        const layers = pulseLayers(track.length, track.cycle);
        const delays = Array.from({ length: track.count }, (_, k) => Math.round(k * PULSE_PERIOD * 1000) / 1000);
        return delays.flatMap((delay, k) =>
          layers.map((layer, n) => (
            <path
              key={`${i}:${k}:${n}`}
              data-flow-pulse={n === 0 ? '' : undefined}
              d={track.path}
              strokeDasharray={layer.dasharray}
              style={{
                stroke: color,
                strokeWidth: width,
                strokeOpacity: layer.opacity,
                '--sk-pulse-from': `${layer.from}px`,
                '--sk-pulse-to': `${layer.to}px`,
                '--sk-pulse-dur': `${track.cycle}s`,
                '--sk-pulse-delay': `-${delay}s`,
              } as CSSProperties}
            />
          )),
        );
      })}
    </g>
  );
}
