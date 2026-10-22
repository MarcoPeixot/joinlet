import { siGithub } from './integrationMarks';

export function GitHubIcon({ size = 18 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"><path fill="currentColor" d={siGithub.path} /></svg>;
}
