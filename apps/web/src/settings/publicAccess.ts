/** Operator-selected browser preview; it grants no access to hosted accounts or data. */
export function isBrowserPreview(): boolean {
  return globalThis.document?.querySelector('meta[name="strukt-mode"]')?.getAttribute('content') === 'browser-preview';
}

let browserGuest = false;
export const isBrowserGuest = () => browserGuest;
export function setBrowserGuest(value: boolean): void { browserGuest = value; }
/** Operator-selected entry experience; hosted APIs retain their own authentication. */
export const allowsOptionalLogin = () => globalThis.document?.querySelector('meta[name="joinlet-optional-login"]')?.getAttribute('content') === 'true';
