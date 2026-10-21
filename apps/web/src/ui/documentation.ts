import { siteUrl } from './urls';
import { getLocale } from '../i18n';

export function documentationUrl(slug = 'introduction'): string {
  return siteUrl(`docs/${getLocale()}/${slug}/`);
}
