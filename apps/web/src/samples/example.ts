import { uiText } from '../i18n';
import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp, ID, NodeBox } from '@strukt/core';
import type { Snapshot } from '../state/diagramStore';

export const EXAMPLE_OPS: DiagramOp[] = [
  { op: 'add_group', id: 'Frontend', color: 'blue', icon: 'monitor-smartphone' },
  { op: 'add_node', id: 'Web App', parentId: 'Frontend', icon: 'react' },
  { op: 'add_node', id: 'Mobile', parentId: 'Frontend', icon: 'smartphone' },
  { op: 'add_node', id: 'API Gateway', icon: 'nginx' },
  { op: 'add_group', id: 'Serviços', label: uiText('Serviços'), color: 'purple', icon: 'layers' },
  { op: 'add_node', id: 'Pedidos', label: uiText('Pedidos'), parentId: 'Serviços', icon: 'nodejs', tech: 'Node.js' },
  { op: 'add_node', id: 'Pagamentos', label: uiText('Pagamentos'), parentId: 'Serviços', icon: 'server', tech: 'Go' },
  { op: 'add_group', id: 'Dados', label: uiText('Dados'), color: 'green', icon: 'database' },
  { op: 'add_node', id: 'PostgreSQL', parentId: 'Dados', icon: 'postgres' },
  { op: 'add_node', id: 'Redis', parentId: 'Dados', icon: 'redis' },
  { op: 'add_node', id: 'Kafka', icon: 'kafka' },
  { op: 'connect', from: 'Web App', to: 'API Gateway', label: 'HTTPS' },
  { op: 'connect', from: 'Mobile', to: 'API Gateway', label: 'HTTPS' },
  { op: 'connect', from: 'API Gateway', to: 'Pedidos' },
  { op: 'connect', from: 'API Gateway', to: 'Pagamentos' },
  { op: 'connect', from: 'Pedidos', to: 'PostgreSQL', label: 'SQL' },
  { op: 'connect', from: 'Pagamentos', to: 'PostgreSQL' },
  { op: 'connect', from: 'Pedidos', to: 'Redis', label: 'cache' },
  { op: 'connect', from: 'Pedidos', to: 'Kafka', connector: '-->', label: uiText("eventos") },
  { op: 'connect', from: 'Kafka', to: 'Pagamentos', connector: '-->' },
];

export const EXAMPLE_POSITIONS: Record<ID, NodeBox> = {
  'Web App': { x: 60, y: 80 },
  Mobile: { x: 60, y: 240 },
  'API Gateway': { x: 330, y: 160 },
  Pedidos: { x: 600, y: 80 },
  Pagamentos: { x: 600, y: 240 },
  PostgreSQL: { x: 900, y: 80 },
  Redis: { x: 900, y: 240 },
  Kafka: { x: 600, y: 440 },
};

export function exampleSnapshot(): Snapshot {
  const result = applyOps(emptyModel(), EXAMPLE_OPS);
  if (!result.ok) throw new Error(uiText("Exemplo inválido: {0}", [result.error.message]));
  return { model: result.model, layout: { nodes: { ...EXAMPLE_POSITIONS }, edges: {} } };
}
