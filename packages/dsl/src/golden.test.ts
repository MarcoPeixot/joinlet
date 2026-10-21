import { applyOps, diffModels, emptyModel, semanticView } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { ERASER_EXAMPLES } from './fixtures/eraser';
import { parseDsl } from './parse';
import { printDsl } from './print';

describe('Eraser reference examples', () => {
  it.each(Object.entries(ERASER_EXAMPLES))('%s parses cleanly, satisfies core invariants and round-trips', (_name, text) => {
    const { model, diagnostics } = parseDsl(text);
    expect(diagnostics).toEqual([]);
    // Rebuilding through applyOps re-validates every invariant (unique names, group parents, no cycles).
    const rebuilt = applyOps(emptyModel(), diffModels(emptyModel(), model));
    expect(rebuilt.ok && semanticView(rebuilt.model)).toEqual(semanticView(model));
    expect(semanticView(parseDsl(printDsl(model)).model)).toEqual(semanticView(model));
  });

  it('AWS diagram: groups, chains and fan-out', () => {
    const { model } = parseDsl(ERASER_EXAMPLES['arch: AWS Diagram']!);
    expect(model.order).toHaveLength(13);
    expect(model.edges).toHaveLength(9);
    expect(model.elements.Server).toMatchObject({ parentId: 'Main Server', icon: 'aws-ec2' });
    expect(model.elements['Main Server']?.parentId).toBe('VPC Subnet');
    expect(model.edges.find((e) => e.from === 'S3')).toMatchObject({ to: 'Data', connector: '<' });
    expect(printDsl(model)).toBe(`API gateway [icon: aws-api-gateway]
Lambda [icon: aws-lambda]
S3 [icon: aws-simple-storage-service]
VPC Subnet {
  Main Server {
    Server [icon: aws-ec2]
    Data [icon: aws-rds]
  }
  Queue [icon: aws-auto-scaling]
  Compute Nodes {
    Worker1 [icon: aws-ec2]
    Worker2 [icon: aws-ec2]
    Worker3 [icon: aws-ec2]
  }
}
Analytics [icon: aws-redshift]

API gateway > Lambda
Lambda > Server
Server > Data
Server > Queue
Queue > Worker1
Queue > Worker2
Queue > Worker3
S3 < Data
Compute Nodes > Analytics
`);
  });

  it('Azure and Kubernetes diagrams: many-to-many chains', () => {
    expect(parseDsl(ERASER_EXAMPLES['arch: Azure Diagram']!).model.edges).toHaveLength(10);
    const k8s = parseDsl(ERASER_EXAMPLES['arch: Kubernetes Diagram']!).model;
    expect(k8s.edges).toHaveLength(14);
    expect(k8s.elements.api?.parentId).toBe('Control Plane');
  });

  it('Price Lookup flow: inline node props and a group declared after its members', () => {
    const { model } = parseDsl(ERASER_EXAMPLES['flow: Price Lookup Flow']!);
    expect(model.elements.Start).toMatchObject({ shape: 'oval', icon: 'flag' });
    expect(model.elements.End).toMatchObject({ shape: 'oval', icon: 'check' });
    expect(model.elements['Retrieve item price']?.parentId).toBe('For each keyword in the list');
    expect(model.edges.find((e) => e.to === 'Close modal')?.label).toBe('User clicks cancel');
    expect(model.edges).toHaveLength(9);
  });

  it('Issue Triage flow: labels with question marks', () => {
    const { model } = parseDsl(ERASER_EXAMPLES['flow: Issue Triage Flow']!);
    expect(model.elements['Duplicate?']).toMatchObject({ shape: 'diamond', parentId: 'BugPath' });
    expect(model.edges.find((e) => e.from === 'Duplicate?' && e.to === 'Has repro?')?.label).toBe('No');
  });
});
