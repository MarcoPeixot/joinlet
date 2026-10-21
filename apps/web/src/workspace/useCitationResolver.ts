import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DiagramModel } from '@strukt/core';
import { workspaceResolver } from '../chat/citations';
import type { CitableDiagram, CitationResolver } from '../chat/citations';
import { useWorkspace } from './appWorkspace';
export function useCitationResolver(): CitationResolver {
  const parts = useWorkspace(
    useShallow((s) => (s.data ? s.data.manifest.diagrams.flatMap((d) => [d.slug, d.title, s.data!.diagrams[d.slug]?.model.elements]) : [])),
  );
  const open = useWorkspace((s) => (s.view.kind === 'diagram' ? s.diagram : null));
  return useMemo(() => {
    const diagrams: CitableDiagram[] = [];
    for (let i = 0; i < parts.length; i += 3) {
      const elements = parts[i + 2] as DiagramModel['elements'] | undefined;
      if (elements) diagrams.push({ slug: parts[i] as string, title: parts[i + 1] as string, model: { elements } });
    }
    return workspaceResolver(diagrams, open);
  }, [parts, open]);
}
