import { SidePanel } from './Panel';

/** Stands in for a right-slot panel while its chunk loads, so the slot does not open empty. */
export function PanelSkeleton({ label }: { label: string }) {
  return (
    <SidePanel label={label}>
      <div className="flex h-12 shrink-0 items-center border-b border-line px-3.5">
        <div className="sk-skeleton h-3.5 w-28 rounded-chip" />
      </div>
      <div aria-busy="true" className="flex flex-col gap-3 p-3.5">
        <div className="sk-skeleton h-3 w-full rounded-chip" />
        <div className="sk-skeleton h-3 w-4/5 rounded-chip" />
        <div className="sk-skeleton h-3 w-3/5 rounded-chip" />
      </div>
    </SidePanel>
  );
}
