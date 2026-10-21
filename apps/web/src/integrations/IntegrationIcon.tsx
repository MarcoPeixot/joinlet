import { siAtlassian, siConfluence, siDiscord, siJira, siNotion } from '../brand/integrationMarks';
export type IntegrationBrand = 'slack' | 'teams' | 'discord' | 'notion' | 'atlassian' | 'confluence' | 'jira';
const icons = { discord: siDiscord, notion: siNotion, atlassian: siAtlassian, confluence: siConfluence, jira: siJira };
/** Local vector marks; loading settings never fetches assets from an integration provider. */
export function IntegrationIcon({ brand, size = 22 }: { brand: IntegrationBrand; size?: number }) {
  if (brand === 'slack') return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><g fill="#36c5f0"><rect x="2" y="7" width="9" height="4" rx="2" /><rect x="7" y="2" width="4" height="4" rx="2" /></g><g fill="#2eb67d"><rect x="13" y="2" width="4" height="9" rx="2" /><rect x="18" y="7" width="4" height="4" rx="2" /></g><g fill="#ecb22e"><rect x="13" y="13" width="9" height="4" rx="2" /><rect x="13" y="18" width="4" height="4" rx="2" /></g><g fill="#e01e5a"><rect x="7" y="13" width="4" height="9" rx="2" /><rect x="2" y="13" width="4" height="4" rx="2" /></g></svg>;
  if (brand === 'teams') return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><circle cx="16" cy="5" r="3" fill="#8b87da" /><circle cx="21" cy="8" r="2" fill="#a5a1e5" /><path d="M14 10h9v7a4 4 0 0 1-8 0Z" fill="#8b87da" /><path d="M8 9h11v9a5.5 5.5 0 0 1-11 0Z" fill="#716bc1" /><rect x="1" y="7" width="12" height="13" rx="2" fill="#5650a5" /><path d="M4 10h6v1.5H7.8V17H6.2v-5.5H4Z" fill="#fff" /></svg>;
  const icon = icons[brand];
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill={brand === 'notion' ? 'currentColor' : `#${icon.hex}`} d={icon.path} /></svg>;
}
