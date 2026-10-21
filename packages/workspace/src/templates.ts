import type { DiagramOp, ID, NodeBox } from '@strukt/core';
import { CLOUD_TEMPLATES } from './templateCloud';
import { SYSTEM_TEMPLATES } from './templateSystems';
import { SPECIALIST_TEMPLATES } from './specialistTemplates';
export { SPECIALIST_TEMPLATES } from './specialistTemplates';

export interface DiagramTemplate {
  id: string;
  title: string;
  description: string;
  category?: string;
  libraryId?: string;
  keywords?: readonly string[];
  positions?: Record<ID, NodeBox>;
  /** Applied to an empty diagram through `applyOps`; ids double as visible labels. */
  ops: DiagramOp[];
}

export const BASIC_TEMPLATES: DiagramTemplate[] = [
  ...CLOUD_TEMPLATES,
  ...SYSTEM_TEMPLATES,
  {
    id: 'microservices',
    category: 'Arquitetura',
    title: 'Microsserviços',
    description: 'Clientes, gateway, serviços independentes e um banco por serviço.',
    positions: {
      Aplicativo: { x: 0, y: 40 }, 'Portal Web': { x: 0, y: 330 }, 'Gateway de API': { x: 330, y: 180 },
      Pedidos: { x: 660, y: 40 }, Clientes: { x: 660, y: 330 }, Catálogo: { x: 660, y: 620 },
      'Banco de Pedidos': { x: 1000, y: 40 }, 'Banco de Clientes': { x: 1000, y: 330 },
    },
    ops: [
      { op: 'add_node', id: 'Aplicativo', icon: 'smartphone' },
      { op: 'add_node', id: 'Portal Web', icon: 'react' },
      { op: 'add_node', id: 'Gateway de API', icon: 'nginx' },
      { op: 'add_group', id: 'Serviços', color: 'purple', icon: 'layers' },
      { op: 'add_node', id: 'Pedidos', parentId: 'Serviços', icon: 'server' },
      { op: 'add_node', id: 'Clientes', parentId: 'Serviços', icon: 'server' },
      { op: 'add_node', id: 'Catálogo', parentId: 'Serviços', icon: 'server' },
      { op: 'add_node', id: 'Banco de Pedidos', shape: 'cylinder', icon: 'postgres' },
      { op: 'add_node', id: 'Banco de Clientes', shape: 'cylinder', icon: 'postgres' },
      { op: 'connect', from: 'Aplicativo', to: 'Gateway de API', label: 'HTTPS' },
      { op: 'connect', from: 'Portal Web', to: 'Gateway de API', label: 'HTTPS' },
      { op: 'connect', from: 'Gateway de API', to: 'Pedidos' },
      { op: 'connect', from: 'Gateway de API', to: 'Clientes' },
      { op: 'connect', from: 'Gateway de API', to: 'Catálogo' },
      { op: 'connect', from: 'Pedidos', to: 'Banco de Pedidos', label: 'SQL' },
      { op: 'connect', from: 'Clientes', to: 'Banco de Clientes', label: 'SQL' },
    ],
  },
  {
    id: 'c4-context',
    category: 'Arquitetura',
    title: 'Contexto (C4)',
    description: 'Pessoas, o seu sistema e os sistemas externos com que ele conversa.',
    positions: {
      Cliente: { x: 0, y: 60 }, Atendente: { x: 0, y: 390 }, 'Meu Sistema': { x: 370, y: 240 },
      'Gateway de Pagamento': { x: 750, y: 30 }, 'Serviço de E-mail': { x: 750, y: 280 }, 'Sistema Legado': { x: 750, y: 530 },
    },
    ops: [
      { op: 'add_node', id: 'Cliente', shape: 'oval', icon: 'user' },
      { op: 'add_node', id: 'Atendente', shape: 'oval', icon: 'user' },
      { op: 'add_node', id: 'Meu Sistema', color: 'blue', icon: 'layers' },
      { op: 'add_node', id: 'Gateway de Pagamento', icon: 'server' },
      { op: 'add_node', id: 'Serviço de E-mail', icon: 'mail' },
      { op: 'add_node', id: 'Sistema Legado', icon: 'server' },
      { op: 'connect', from: 'Cliente', to: 'Meu Sistema', label: 'usa' },
      { op: 'connect', from: 'Atendente', to: 'Meu Sistema', label: 'administra' },
      { op: 'connect', from: 'Meu Sistema', to: 'Gateway de Pagamento', label: 'cobra' },
      { op: 'connect', from: 'Meu Sistema', to: 'Serviço de E-mail', label: 'envia avisos' },
      { op: 'connect', from: 'Meu Sistema', to: 'Sistema Legado', label: 'sincroniza' },
    ],
  },
  {
    id: 'event-driven',
    category: 'Arquitetura',
    title: 'Orientada a eventos',
    description: 'Produtores publicam eventos num barramento e consumidores reagem a eles.',
    positions: {
      'API de Pedidos': { x: 0, y: 270 }, 'Barramento de Eventos': { x: 330, y: 270 },
      Cobrança: { x: 690, y: 0 }, Estoque: { x: 690, y: 270 }, Notificações: { x: 690, y: 540 },
      'Fila de Falhas': { x: 1030, y: 0 },
    },
    ops: [
      { op: 'add_node', id: 'API de Pedidos', icon: 'nodejs' },
      { op: 'add_node', id: 'Barramento de Eventos', icon: 'kafka' },
      { op: 'add_node', id: 'Cobrança', icon: 'server' },
      { op: 'add_node', id: 'Estoque', icon: 'server' },
      { op: 'add_node', id: 'Notificações', icon: 'server' },
      { op: 'add_node', id: 'Fila de Falhas', shape: 'parallelogram' },
      { op: 'connect', from: 'API de Pedidos', to: 'Barramento de Eventos', connector: '-->', label: 'pedido criado' },
      { op: 'connect', from: 'Barramento de Eventos', to: 'Cobrança', connector: '-->' },
      { op: 'connect', from: 'Barramento de Eventos', to: 'Estoque', connector: '-->' },
      { op: 'connect', from: 'Barramento de Eventos', to: 'Notificações', connector: '-->' },
      { op: 'connect', from: 'Cobrança', to: 'Fila de Falhas', connector: '-->', label: 'falhou' },
    ],
  },
  {
    id: 'rag',
    category: 'Dados e IA',
    title: 'Busca com IA (RAG)',
    description: 'Documentos indexados em vetores e um modelo que responde com esse contexto.',
    positions: {
      Usuário: { x: 0, y: 100 }, 'API de Perguntas': { x: 310, y: 100 }, 'Gerador de Vetores': { x: 620, y: 100 },
      'Banco Vetorial': { x: 940, y: 100 }, 'Modelo de Linguagem': { x: 1240, y: 100 },
      Documentos: { x: 620, y: 430 }, Indexador: { x: 940, y: 430 },
    },
    ops: [
      { op: 'add_node', id: 'Usuário', shape: 'oval', icon: 'user' },
      { op: 'add_node', id: 'API de Perguntas', icon: 'server' },
      { op: 'add_node', id: 'Gerador de Vetores', icon: 'sparkles' },
      { op: 'add_node', id: 'Banco Vetorial', shape: 'cylinder', icon: 'database' },
      { op: 'add_node', id: 'Modelo de Linguagem', color: 'purple', icon: 'sparkles' },
      { op: 'add_node', id: 'Documentos', shape: 'document' },
      { op: 'add_node', id: 'Indexador', icon: 'server' },
      { op: 'connect', from: 'Usuário', to: 'API de Perguntas', label: 'pergunta' },
      { op: 'connect', from: 'API de Perguntas', to: 'Gerador de Vetores' },
      { op: 'connect', from: 'Gerador de Vetores', to: 'Banco Vetorial', label: 'busca' },
      { op: 'connect', from: 'Banco Vetorial', to: 'Modelo de Linguagem', label: 'contexto' },
      { op: 'connect', from: 'Modelo de Linguagem', to: 'Usuário', label: 'resposta' },
      { op: 'connect', from: 'Documentos', to: 'Indexador' },
      { op: 'connect', from: 'Indexador', to: 'Banco Vetorial', label: 'indexa' },
    ],
  },
  {
    id: 'etl',
    category: 'Dados e IA',
    title: 'Pipeline de dados (ETL)',
    description: 'Fontes extraídas, transformadas e carregadas num data warehouse para análise.',
    positions: {
      'Banco Operacional': { x: 0, y: 0 }, 'Arquivos CSV': { x: 0, y: 270 }, 'API Externa': { x: 0, y: 540 },
      Extração: { x: 350, y: 270 }, Transformação: { x: 660, y: 270 }, 'Data Warehouse': { x: 980, y: 270 }, Painéis: { x: 1320, y: 270 },
    },
    ops: [
      { op: 'add_node', id: 'Banco Operacional', shape: 'cylinder', icon: 'postgres' },
      { op: 'add_node', id: 'Arquivos CSV', shape: 'document' },
      { op: 'add_node', id: 'API Externa', icon: 'server' },
      { op: 'add_node', id: 'Extração', icon: 'server' },
      { op: 'add_node', id: 'Transformação', icon: 'server' },
      { op: 'add_node', id: 'Data Warehouse', shape: 'cylinder', color: 'green', icon: 'database' },
      { op: 'add_node', id: 'Painéis', icon: 'monitor-smartphone' },
      { op: 'connect', from: 'Banco Operacional', to: 'Extração' },
      { op: 'connect', from: 'Arquivos CSV', to: 'Extração' },
      { op: 'connect', from: 'API Externa', to: 'Extração' },
      { op: 'connect', from: 'Extração', to: 'Transformação', label: 'dados brutos' },
      { op: 'connect', from: 'Transformação', to: 'Data Warehouse', label: 'carga' },
      { op: 'connect', from: 'Data Warehouse', to: 'Painéis', label: 'consulta' },
    ],
  },
];

export const TEMPLATES: DiagramTemplate[] = /* @__PURE__ */ (() => [...BASIC_TEMPLATES, ...SPECIALIST_TEMPLATES])();
