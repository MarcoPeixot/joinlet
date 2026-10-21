import type { PulseTrack } from './flowPulse';
import { pulseBar } from './flowPulse';

/** Fades in as it leaves the source border and out as it reaches the arrow tip. */
const FADE = { values: '0;1;1;0', keyTimes: '0;0.08;0.9;1' };

/**
 * "Animar fluxo" and the focus pulse: two requests per track, half a trip apart, each a short bar sliding
 * along the edge's own route (a single dash whose offset moves). Pure declarative SVG (SMIL): the browser
 * runs it, React never re-renders per frame. Offsets are on the document timeline, so bars keep their pace
 * when an edge re-renders.
 */
export function FlowPulses({ tracks, color }: { tracks: readonly PulseTrack[]; color: string }) {
  return (
    <g className="strukt-flow" aria-hidden>
      {tracks.flatMap((track, i) => {
        const bar = pulseBar(track.length);
        return [0, track.dur / 2].map((delay, k) => {
          const timing = { dur: `${track.dur}s`, begin: delay ? `-${delay}s` : '0s', repeatCount: 'indefinite' };
          const dash = (width: number, opacity: number) => (
            <path d={track.path} fill="none" strokeLinecap="butt" strokeDasharray={bar.dasharray} strokeDashoffset={bar.from} style={{ stroke: color, strokeWidth: width, opacity }}>
              <animate {...timing} attributeName="stroke-dashoffset" from={bar.from} to={bar.to} />
            </path>
          );
          return (
            <g key={`${i}:${k}`} data-flow-pulse="" opacity={0}>
              {dash(8, 0.22)}
              {dash(3.25, 1)}
              <animate {...timing} attributeName="opacity" values={FADE.values} keyTimes={FADE.keyTimes} />
            </g>
          );
        });
      })}
    </g>
  );
}
