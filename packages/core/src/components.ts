import type { LayoutRole, Presentation, Shape, TableField } from './model';

export interface ComponentPreset {
  kind?: 'node' | 'group';
  id: string;
  label: string;
  category: string;
  description: string;
  /** Built-in discovery metadata, never copied into the diagram's runtime model. */
  libraryId?: string;
  keywords?: readonly string[];
  shape?: Shape;
  icon?: string;
  color: string;
  tech?: string;
  presentation?: Presentation;
  layoutRole?: LayoutRole;
  fields?: TableField[];
  width?: number;
  height?: number;
}

/** Visual defaults only; a preset never implies dependencies or changes the component's identity. */
export const BASIC_COMPONENT_PRESETS: readonly ComponentPreset[] = [
  { id: 'service', presentation: 'card', layoutRole: 'peer', label: 'Serviço', category: 'Aplicação', description: 'Serviço com uma responsabilidade própria', icon: 'server', color: 'gray' },
  { id: 'api', presentation: 'card', layoutRole: 'peer', label: 'API', category: 'Aplicação', description: 'Interface HTTP ou RPC', icon: 'braces', color: 'gray' },
  { id: 'worker', presentation: 'card', layoutRole: 'peer', label: 'Worker', category: 'Aplicação', description: 'Processamento em segundo plano', icon: 'cog', color: 'gray' },
  { id: 'function', label: 'Função', category: 'Aplicação', description: 'Função ou tarefa pontual', icon: 'zap', color: 'gray' },
  { id: 'agent', presentation: 'card', layoutRole: 'peer', label: 'Agente de IA', category: 'Aplicação', description: 'Orquestração com modelos e ferramentas', icon: 'brain', color: 'gray' },
  { id: 'database', presentation: 'card', layoutRole: 'peer', label: 'Banco de dados', category: 'Dados', description: 'Persistência estruturada', icon: 'database', color: 'gray' },
  { id: 'cache', presentation: 'card', layoutRole: 'peer', label: 'Cache', category: 'Dados', description: 'Dados temporários e leitura rápida', icon: 'zap', color: 'gray' },
  { id: 'queue', presentation: 'card', layoutRole: 'peer', label: 'Fila', category: 'Dados', description: 'Mensagens e jobs assíncronos', icon: 'layers', color: 'gray' },
  { id: 'storage', presentation: 'card', layoutRole: 'peer', label: 'Armazenamento', category: 'Dados', description: 'Objetos, arquivos e mídia', icon: 'archive', color: 'gray' },
  { id: 'server', presentation: 'card', layoutRole: 'peer', label: 'Servidor', category: 'Infraestrutura', description: 'Máquina ou instância de execução', icon: 'server', color: 'gray' },
  { id: 'cloud', label: 'Nuvem', category: 'Infraestrutura', description: 'Ambiente ou plataforma de nuvem', icon: 'cloud', color: 'gray' },
  { id: 'external', presentation: 'card', layoutRole: 'peer', label: 'Sistema externo', category: 'Infraestrutura', description: 'Integração fora da fronteira do projeto', icon: 'plug', color: 'gray' },
  { id: 'gateway', presentation: 'card', layoutRole: 'peer', label: 'Gateway', category: 'Infraestrutura', description: 'Entrada, proxy e roteamento', icon: 'network', color: 'gray' },
  { id: 'user', label: 'Usuário', category: 'Pessoas e canais', description: 'Pessoa que interage com o sistema', icon: 'user', color: 'gray' },
  { id: 'web', label: 'Aplicação web', category: 'Pessoas e canais', description: 'Cliente no navegador', icon: 'monitor', color: 'gray' },
  { id: 'mobile', label: 'Aplicação mobile', category: 'Pessoas e canais', description: 'Cliente no celular', icon: 'smartphone', color: 'gray' },
  { id: 'event', label: 'Evento', category: 'Fluxos', description: 'Entrada ou saída de um fluxo', shape: 'oval', icon: 'radio', color: 'gray' },
  { id: 'decision', label: 'Decisão', category: 'Fluxos', description: 'Condição com caminhos alternativos', shape: 'diamond', color: 'gray' },
  { id: 'process', label: 'Processo', category: 'Fluxos', description: 'Etapa de execução', shape: 'rectangle', icon: 'workflow', color: 'gray' },
  { id: 'delay', label: 'Espera', category: 'Fluxos', description: 'Atraso, debounce ou janela temporal', icon: 'clock', color: 'gray' },
  { id: 'document', label: 'Documento', category: 'Organização', description: 'Conteúdo ou artefato produzido', icon: 'file-text', color: 'gray' },
  { id: 'note', label: 'Nota', category: 'Organização', description: 'Anotação ou regra explicativa', icon: 'sticky-note', color: 'gray' },
  { id: 'package', presentation: 'card', layoutRole: 'peer', label: 'Módulo', category: 'Organização', description: 'Módulo ou conjunto de funcionalidades', icon: 'layers', color: 'gray' },
  { id: 'nestjs', label: 'API NestJS', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'API ou serviço NestJS', icon: 'nestjs', color: 'gray', tech: 'NestJS' },
  { id: 'fastapi', label: 'API FastAPI', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'API ou serviço Python', icon: 'fastapi', color: 'gray', tech: 'FastAPI · Python' },
  { id: 'python', label: 'Worker Python', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Processo Python', icon: 'python', color: 'gray', tech: 'Python' },
  { id: 'postgres', label: 'PostgreSQL', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Banco relacional PostgreSQL', icon: 'postgresql', color: 'gray', tech: 'PostgreSQL' },
  { id: 'redis', label: 'Redis', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Cache e transporte de mensagens', icon: 'redis', color: 'gray', tech: 'Redis' },
  { id: 's3', label: 'Amazon S3', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Armazenamento de objetos AWS', icon: 'aws-s3', color: 'gray', tech: 'Amazon S3' },
  { id: 'nginx', label: 'Nginx', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Proxy reverso e servidor HTTP', icon: 'nginx', color: 'gray', tech: 'Nginx' },
  { id: 'react', label: 'React', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Interface React', icon: 'react', color: 'gray', tech: 'React' },
  { id: 'nodejs', label: 'Node.js', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Runtime JavaScript', icon: 'nodejs', color: 'gray', tech: 'Node.js' },
  { id: 'docker', label: 'Docker', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Container Docker', icon: 'docker', color: 'gray', tech: 'Docker' },
  { id: 'kubernetes', label: 'Kubernetes', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Orquestração de containers', icon: 'kubernetes', color: 'gray', tech: 'Kubernetes' },
  { id: 'stripe', label: 'Stripe', category: 'Tecnologias', presentation: 'card', layoutRole: 'peer', description: 'Integração de pagamentos', icon: 'stripe', color: 'gray', tech: 'Stripe' },
  { id: 'data-table', label: 'Tabela de dados', category: 'Dados', description: 'Tabela com campos tipados e chaves primárias ou estrangeiras', presentation: 'table', icon: 'table', color: 'gray', fields: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'name', type: 'text' }] },
  { id: 'sequence-participant', label: 'Participante', category: 'Fluxos', description: 'Participante de uma sequência de mensagens', presentation: 'participant', icon: 'server', color: 'gray' },
];

export const COMPONENT_PRESETS: readonly ComponentPreset[] = BASIC_COMPONENT_PRESETS;
