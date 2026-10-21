import { Handle, Position } from '@xyflow/react';

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;

/**
 * Four visible-on-hover ports start connections (ConnectionMode.Loose lets them receive too).
 * The hidden target handle exists only so React Flow can attach edges; geometry comes from our router.
 */
export function NodeHandles() {
  return (
    <>
      {SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={side} className="strukt-handle" aria-hidden />
      ))}
      <Handle id="in" type="target" position={Position.Top} className="strukt-handle strukt-handle--hidden" isConnectableStart={false} aria-hidden />
    </>
  );
}
