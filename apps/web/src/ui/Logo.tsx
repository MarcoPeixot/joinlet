import { uiText } from '../i18n';
/** Joinlet: two ideas connected by a shared point. Colors adapt to both surfaces. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size * 1.45} height={size} viewBox="0 0 42 29" aria-hidden="true" focusable="false">
      <rect x="1" y={"2"} width="19" height="25" rx="6.5" fill="var(--sk-logo-dark, #111827)" />
      <rect x="23" y={"2"} width="18" height="25" rx="6.5" fill="#a3ff3d" />
      <circle cx="21.5" cy="14.5" r="6.3" fill="var(--sk-logo-joint, #faf9f4)" />
    </svg>
  );
}
