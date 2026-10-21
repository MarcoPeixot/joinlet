import { uiText } from '../i18n';
import { updateSection } from '@strukt/workspace';
import { NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { InlineInput } from '../ui/InlineInput';
import { workspace } from '../workspace/appWorkspace';
import type { SectionNode } from './boardFlow';

/** Section frame: drag it by the header (its cards come along), resize when selected, double-click to rename. */
export const SectionNodeView = memo(function SectionNodeView({ data, selected }: NodeProps<SectionNode>) {
  const { section } = data;
  const [editing, setEditing] = useState(false);
  return (
    <div className="strukt-section" data-selected={selected || undefined}>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={160} color="var(--sk-accent)" />
      <header className="strukt-section__head" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <div className="nodrag w-64">
            <InlineInput
              initial={section.title}
              label={uiText("Título da seção")}
              onCommit={(title) => {
                workspace.updateBoard((board) => updateSection(board, section.id, { title }));
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <span className="truncate" title={uiText("Duplo clique para renomear")}>
            {section.title}
          </span>
        )}
      </header>
    </div>
  );
});
