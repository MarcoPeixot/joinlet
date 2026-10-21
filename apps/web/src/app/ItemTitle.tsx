import { uiText } from '../i18n';
import { ITEM_LIST } from '@strukt/workspace';
import type { ItemKind } from '@strukt/workspace';
import { LayoutDashboard } from 'lucide-react';
import { useState } from 'react';
import { InlineInput } from '../ui/InlineInput';
import { renameItem } from '../workspace/actions';
import { useWorkspace } from '../workspace/appWorkspace';
import { ITEM_ICONS } from '../workspace/labels';

/** Title of what the main area shows; click to rename the diagram (or doc/sketch). */
export function ItemTitle() {
  const view = useWorkspace((s) => s.view);
  const diagram = useWorkspace((s) => s.diagram);
  const current: { kind: ItemKind; slug: string } | null =
    view.kind === 'diagram' ? (diagram ? { kind: 'diagram', slug: diagram } : null) : view.kind === 'board' ? null : view;
  const title = useWorkspace((s) => (current ? s.data?.manifest[ITEM_LIST[current.kind]].find((e) => e.slug === current.slug)?.title : undefined));
  const [editing, setEditing] = useState(false);
  if (!current || title === undefined) {
    return (
      <span className="flex items-center gap-1.5 px-1.5 text-body font-medium">
        <LayoutDashboard size={14} className="text-muted" /> Overview
      </span>
    );
  }
  const Icon = ITEM_ICONS[current.kind];
  if (editing) {
    return (
      <div className="w-64">
        <InlineInput
          initial={title}
          label={uiText("Título")}
          onCommit={(value) => {
            renameItem(current.kind, current.slug, value);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      title={uiText("Renomear")}
      className="flex min-w-0 max-w-80 items-center gap-1.5 rounded-control px-1.5 py-1 text-body font-medium transition-colors duration-(--sk-motion-fast) hover:bg-panel-2"
      onClick={() => setEditing(true)}
    >
      <Icon size={14} className="flex-none text-muted" />
      <span className="truncate">{title}</span>
    </button>
  );
}
