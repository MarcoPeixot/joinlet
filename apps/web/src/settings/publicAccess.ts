/** Operator-selected browser preview; it grants no access to hosted accounts or data. */
export function isBrowserPreview(): boolean {
  return globalThis.document?.querySelector('meta[name="strukt-mode"]')?.getAttribute('content') === 'browser-preview';
}
