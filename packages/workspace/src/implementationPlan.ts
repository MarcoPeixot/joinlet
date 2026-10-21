import { compareModels, DEFAULT_STYLE } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import type { WorkspaceData } from './workspace';
import type { SyncPlan } from './sync';

/** Ignore layout, colors and explanatory annotations: these are not implementation requirements. */
function contract(model: DiagramModel): DiagramModel {
  return {
    ...model, style: DEFAULT_STYLE, diagnostics: [],
    elements: Object.fromEntries(Object.values(model.elements).map(el => {
      const { id, kind, parentId, label, tech, fields } = el;
      return [id, { id, kind, ...(parentId ? { parentId } : {}), ...(label ? { label } : {}), ...(tech ? { tech } : {}), ...(fields ? { fields } : {}) }];
    })),
    edges: model.edges.map(({ id, from, to, connector, label }) => ({ id, kind: 'edge' as const, from, to, connector, ...(label ? { label } : {}) })),
  };
}
const changed = (changes: ReturnType<typeof compareModels>) => Object.values(changes.elements).some(items => items.length) || Object.values(changes.edges).some(items => items.length);

/** A review handoff, never an executable patch or a promise that the importer understands arbitrary application code. */
export function implementationPlan(plan: SyncPlan, data: WorkspaceData) {
  const diagrams = plan.diagrams.map(diagram => {
    const source = diagram.sourceModel;
    const differences = source ? compareModels(contract(source), contract(diagram.before)) : null;
    return {
      diagram: diagram.slug, title: diagram.title, blocked: diagram.blocked,
      files: [...new Set(plan.sources.filter(s => s.diagram === diagram.slug).flatMap(s => s.files))].sort(),
      sourceChangesSinceSync: source && diagram.baseline ? compareModels(contract(diagram.baseline), contract(source)) : null,
      diagramChangesSinceSync: diagram.baseline ? compareModels(contract(diagram.baseline), contract(diagram.before)) : null,
      sourceToDiagramPending: diagram.ops.length > 0,
      reviewRequired: !!differences && changed(differences),
      // Direction is explicit: additions here exist in the diagram but not in the imported source.
      sourceToDesiredArchitecture: differences,
      notes: diagram.notes,
    };
  });
  const mapped = new Set(diagrams.map(d => d.diagram));
  return {
    version: 1, writesCode: false,
    coverage: 'Only configured source formats and explicitly linked evidence; not arbitrary code semantics.',
    configured: plan.configured, errors: plan.errors,
    diagrams,
    unmappedDiagrams: data.manifest.diagrams.filter(d => !mapped.has(d.slug)).map(d => d.slug),
    documents: data.manifest.docs.map(d => ({ title: d.title, path: `docs/${d.slug}.md` })),
    nextSteps: [
      'Read the source files, related documents and evidence. Decide whether code or the diagram describes the intended behavior; differences are review candidates, not automatic edits.',
      'If code changed, run joinlet sync and review the merge. If architecture changed, implement the intended change in the repository with your coding agent, including tests.',
      'Update authored documents with write_doc. Run joinlet sync, joinlet context, the repository tests and joinlet verify --strict. Commit code and .arch together in the same reviewed change.',
    ],
  };
}
