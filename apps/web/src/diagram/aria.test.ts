import type { DiagramElement } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { edgeAriaLabel, nodeAriaLabel } from './aria';

const node = (extra: Partial<DiagramElement> = {}): DiagramElement => ({ kind: 'node', id: 'Pedidos', label: 'Pedidos', ...extra }) as DiagramElement;

describe('nodeAriaLabel', () => {
  it('names the shape, label, technology and connection count', () => {
    expect(nodeAriaLabel(node({ tech: 'Node.js' }), 2)).toBe('Caixa Pedidos, tecnologia Node.js, 2 conexões');
  });

  it('uses shape words in pt-BR and singular for one connection', () => {
    expect(nodeAriaLabel(node({ shape: 'cylinder' } as Partial<DiagramElement>), 1)).toBe('Banco de dados Pedidos, 1 conexão');
    expect(nodeAriaLabel(node({ shape: 'diamond' } as Partial<DiagramElement>), 0)).toBe('Decisão Pedidos, sem conexões');
  });

  it('falls back to the id when there is no label and never prints undefined', () => {
    const out = nodeAriaLabel({ kind: 'node', id: 'API' } as DiagramElement, 0);
    expect(out).toBe('Caixa API, sem conexões');
    expect(out).not.toContain('undefined');
  });

  it('describes groups with their element count', () => {
    const group = { kind: 'group', id: 'Frontend', label: 'Frontend' } as DiagramElement;
    expect(nodeAriaLabel(group, 0, 4)).toBe('Grupo Frontend, 4 elementos');
    expect(nodeAriaLabel(group, 0, 1)).toBe('Grupo Frontend, 1 elemento');
    expect(nodeAriaLabel(group, 0, 0)).toBe('Grupo Frontend, vazio');
  });

  it('treats icon nodes (icon set, no shape) as icons', () => {
    expect(nodeAriaLabel({ kind: 'node', id: 'U', label: 'Usuário', icon: 'user' } as DiagramElement, 1)).toBe('Ícone Usuário, 1 conexão');
  });

  it('handles hostile labels', () => {
    for (const label of ['constructor', '__proto__', 'toString', '<b>"x"</b>']) {
      const out = nodeAriaLabel(node({ label }), 0);
      expect(out).toContain(label);
      expect(out).not.toContain('undefined');
    }
  });
});

describe('edgeAriaLabel', () => {
  it('names both ends in pt-BR and appends the connection label', () => {
    expect(edgeAriaLabel('Web App', 'API Gateway')).toBe('Conexão de Web App para API Gateway');
    expect(edgeAriaLabel('Web App', 'API Gateway', 'HTTPS')).toBe('Conexão de Web App para API Gateway, HTTPS');
  });

  it('ignores an empty label', () => {
    expect(edgeAriaLabel('A', 'B', '  ')).toBe('Conexão de A para B');
  });
});
