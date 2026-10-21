import { uiText } from '../i18n';
import type { ImportFormat } from '@strukt/dsl/lite';

/** pt-BR names of the architecture formats the Código panel can import. */
export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  mermaid: 'Mermaid',
  likec4: 'LikeC4',
  structurizr: 'Structurizr',
  d2: 'D2',
  terraform: 'Terraform',
  openapi: 'OpenAPI',
  kubernetes: 'Kubernetes',
};

/** File picker filter: `.yaml`/`.yml`/`.json` are told apart by content (OpenAPI vs Kubernetes). */
export const IMPORT_ACCEPT = '.mmd,.mermaid,.c4,.likec4,.dsl,.txt,.d2,.tf,.yaml,.yml,.json';

export const IMPORT_FORMATS_SENTENCE = uiText("Mermaid, LikeC4, Structurizr, D2, Terraform, OpenAPI ou Kubernetes");
