import { createStore, useStore } from 'zustand';

export const liveRegionStore = createStore<{ message: string }>(() => ({ message: '' }));

// A trailing space alternates so announcing the same text twice still changes the DOM (and is read again).
let flip = false;

/** Says `message` to screen readers, politely (it never interrupts what is being read). */
export function announce(message: string): void {
  flip = !flip;
  liveRegionStore.setState({ message: flip ? message : `${message} ` });
}

export function LiveRegionView({ message }: { message: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

/** The one live region of the app (mounted once, in AppShell). */
export function LiveRegion() {
  return <LiveRegionView message={useStore(liveRegionStore, (s) => s.message)} />;
}
