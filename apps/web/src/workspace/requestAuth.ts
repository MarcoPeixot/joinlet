/** Current server session only; never persisted in localStorage or inferred from editable workspace data. */
let csrf: string | undefined;
export function setRequestCsrf(value: string | undefined): void {
  csrf = value;
}
export function requestAuthHeaders(): Record<string, string> {
  return csrf ? { "x-strukt-csrf": csrf } : {};
}
