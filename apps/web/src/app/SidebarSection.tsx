import { uiText } from '../i18n';
import { ITEM_LIST, MAX_FOLDER_DEPTH, buildFolderTree, folderParent, knownFolders } from '@strukt/workspace';
import type { FolderNode, ItemEntry, ItemKind } from '@strukt/workspace';
import { ChevronDown, ChevronRight, Ellipsis, Folder, FolderOpen, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { m } from 'motion/react';
import { useMemo } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { IconButton } from '../ui/IconButton';
import { InlineInput } from '../ui/InlineInput';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu';
import { GLIDE } from '../ui/motion';
import { closeSidebarOnMobile, showToast, toggleFolder, toggleSection, useUi } from '../ui/uiStore';
import { createItem, deleteItem, openItem, renameItem } from '../workspace/actions';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { isViewOnly } from '../workspace/boot';
import { ITEM_ICONS, ITEM_LABELS } from '../workspace/labels';
import { useState } from 'react';

/** "Diagramas · 2": a section's name with how many items it holds (nothing when empty). */
export const sectionLabel = (label: string, count: number): string => (count > 0 ? `${label} · ${count}` : label);

/** `slug === null` creates an item (`folder` = inside that folder); otherwise renames `slug`. */
export type Editing = { kind: ItemKind; slug: string | null; folder?: string } | null;
/** `rename` set = renaming that folder; otherwise creating a folder under `parent` (null = the root). */
export type FolderEditing = { kind: ItemKind; parent: string | null; rename?: string } | null;

const NONE: ItemEntry[] = [];
const NO_PATHS: string[] = [];
const DRAG = 'application/x-strukt-item';

/** A quiet fill follows the active item without competing with the canvas selection. */
function ActivePill() {
  return <m.span layoutId="sidebar-active" transition={GLIDE} className="absolute inset-0 rounded-control bg-accent-soft" />;
}

export function Row({ active, children, over = false, ...rest }: { active: boolean; children: ReactNode; over?: boolean } & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div
      {...rest}
      className={`group relative flex h-8 pointer-coarse:h-10 cursor-pointer items-center gap-2 rounded-control pl-2 pr-1 transition-colors duration-(--sk-motion-fast) ${over ? 'bg-accent-soft text-ink ring-1 ring-accent/40' : active ? 'text-ink' : 'text-muted hover:bg-panel-2/60 hover:text-ink'}`}
    >
      {active && <ActivePill />}
      {children}
    </div>
  );
}

const pretty = (path: string) => path.replaceAll('/', ' / ');
const countItems = (node: FolderNode): number => node.items.length + node.folders.reduce((sum, child) => sum + countItems(child), 0);

/** "Mover para": the root and every folder of the kind (the item's own is disabled). */
function MoveItems({ kind, slug, current, folders }: { kind: ItemKind; slug: string; current?: string; folders: string[] }) {
  return (
    <>
      <MenuLabel>{uiText("Mover para")}</MenuLabel>
      <MenuItem disabled={!current} onSelect={() => workspace.moveItem(kind, slug, null)}>{uiText("Sem pasta")}</MenuItem>
      {folders.map((path) => (
        <MenuItem key={path} disabled={path === current} onSelect={() => workspace.moveItem(kind, slug, path)}>{pretty(path)}</MenuItem>
      ))}
    </>
  );
}

function ItemRow({ kind, item, active, folders, editing, setEditing }: { kind: ItemKind; item: ItemEntry; active: boolean; folders: string[]; editing: Editing; setEditing: (e: Editing) => void }) {
  const Icon = ITEM_ICONS[kind];
  const labels = ITEM_LABELS[kind];
  const viewOnly = isViewOnly();
  if (editing?.kind === kind && editing.slug === item.slug) {
    return (
      <div>
        <InlineInput
          initial={item.title}
          label={uiText("Renomear {0}", [labels.one])}
          onCommit={(title) => {
            renameItem(kind, item.slug, title);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }
  return (
    <Row active={active}>
      <button
        type="button"
        data-row
        aria-current={active ? 'page' : undefined}
        draggable={!viewOnly}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG, `${kind}\n${item.slug}`);
          event.dataTransfer.effectAllowed = 'move';
        }}
        className="relative flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => {
          void openItem(kind, item.slug);
          closeSidebarOnMobile();
        }}
        onDoubleClick={viewOnly ? undefined : () => setEditing({ kind, slug: item.slug })}
      >
        <Icon size={15} className={`flex-none ${active ? 'text-accent' : ''}`} />
        <span className="truncate">{item.title}</span>
      </button>
      {/* Rename, move and delete in one "…" menu: on hover (or focus) with a mouse, always there on touch. */}
      {!viewOnly && <span className="relative -mr-1 ml-auto hidden flex-none items-center self-stretch group-hover:flex group-focus-within:flex has-[[data-state=open]]:flex pointer-coarse:flex">
        {/* Like Nora's sidebar: the menu opens from the button's left edge and grows past the sidebar, over the canvas. */}
        <Menu
          label={uiText("Ações de {0}", [item.title])}
          align="start"
          trigger={
            <IconButton label={uiText("Ações de {0}", [item.title])} title={uiText("Mais ações")} iconSize={14} className="h-full px-0">
              <Ellipsis />
            </IconButton>
          }
        >
          <MenuItem icon={<Pencil size={14} />} onSelect={() => setEditing({ kind, slug: item.slug })}>{uiText("Renomear")}</MenuItem>
          <MenuSeparator />
          <MoveItems kind={kind} slug={item.slug} current={item.folder} folders={folders} />
          <MenuSeparator />
          <MenuItem icon={<Trash2 size={14} />} danger onSelect={() => void deleteItem(kind, item.slug)}>{uiText("Excluir")}</MenuItem>
        </Menu>
      </span>}
    </Row>
  );
}

/** One sidebar section (Diagramas, Documentos, Sketches): a folder tree whose folders fold, take drops and have a menu. */
export function Section({ kind, editing, setEditing, folderEditing, setFolderEditing }: { kind: ItemKind; editing: Editing; setEditing: (e: Editing) => void; folderEditing: FolderEditing; setFolderEditing: (e: FolderEditing) => void }) {
  const viewOnly = isViewOnly();
  const items = useWorkspace((s) => s.data?.manifest[ITEM_LIST[kind]] ?? NONE);
  const declared = useWorkspace((s) => s.data?.manifest.folders?.[ITEM_LIST[kind]]) ?? NO_PATHS;
  const active = useWorkspace((s) => (s.view.kind === 'diagram' ? (kind === 'diagram' ? s.diagram : null) : s.view.kind === kind ? s.view.slug : null));
  const labels = ITEM_LABELS[kind];
  const open = useUi((s) => !s.closedSections.includes(kind));
  const closed = useUi((s) => s.closedFolders);
  const [over, setOver] = useState<string | null>(null);
  const tree = useMemo(() => buildFolderTree(items, declared), [items, declared]);
  const folders = useMemo(() => knownFolders(items, declared), [items, declared]);
  const creatingItem = (folder?: string) => editing?.kind === kind && editing.slug === null && editing.folder === folder;
  const creatingFolder = (parent: string | null) => folderEditing?.kind === kind && !folderEditing.rename && folderEditing.parent === parent;

  /** Drop target props: a folder path, or null for the section root. */
  const drop = (path: string | null) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG)) return;
      event.preventDefault();
      setOver(path ?? '');
    },
    onDragLeave: () => setOver(null),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setOver(null);
      const [from, slug] = event.dataTransfer.getData(DRAG).split("\n");
      if (from === kind && slug) workspace.moveItem(kind, slug, path);
    },
  });

  const itemInput = (folder?: string) =>
    creatingItem(folder) && (
      <div>
        <InlineInput
          initial=""
          placeholder={labels.placeholder}
          label={labels.placeholder}
          onCommit={(title) => {
            setEditing(null);
            void createItem(kind, title, folder);
          }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );

  const folderInput = (parent: string | null) =>
    creatingFolder(parent) && (
      <div>
        <InlineInput
          initial=""
          placeholder={uiText("Nome da pasta")}
          label={uiText("Nome da pasta")}
          onCommit={(name) => {
            setFolderEditing(null);
            workspace.createFolder(kind, parent ? `${parent}/${name}` : name);
          }}
          onCancel={() => setFolderEditing(null)}
        />
      </div>
    );

  const renderItem = (item: ItemEntry) => (
    <ItemRow key={item.slug} kind={kind} item={item} active={active === item.slug} folders={folders} editing={editing} setEditing={setEditing} />
  );

  const renderFolder = (node: FolderNode): ReactNode => {
    const id = `${kind}:${node.path}`;
    const isOpen = !closed.includes(id);
    if (folderEditing?.kind === kind && folderEditing.rename === node.path) {
      const parent = folderParent(node.path);
      return (
        <div key={node.path}>
          <InlineInput
            initial={node.name}
            label={uiText("Nome da pasta")}
            onCommit={(name) => {
              setFolderEditing(null);
              workspace.renameFolder(kind, node.path, parent ? `${parent}/${name}` : name);
            }}
            onCancel={() => setFolderEditing(null)}
          />
        </div>
      );
    }
    return (
      <div key={node.path}>
        <Row active={false} over={over === node.path} {...drop(node.path)}>
          <button type="button" data-row aria-expanded={isOpen} className="relative flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => toggleFolder(kind, node.path)}>
            <ChevronRight size={12} className={`flex-none transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            {isOpen ? <FolderOpen size={15} className="flex-none" /> : <Folder size={15} className="flex-none" />}
            <span className="truncate">{node.name}</span>
            <span className="text-meta text-faint">{countItems(node)}</span>
          </button>
          {!viewOnly && <span className="relative hidden items-center group-hover:flex group-focus-within:flex pointer-coarse:flex">
            <Menu
              label={uiText("Ações da pasta {0}", [node.name])}
              trigger={
                <IconButton label={uiText("Ações da pasta {0}", [node.name])} className="h-6 min-w-6 px-1">
                  <Ellipsis />
                </IconButton>
              }
            >
              <MenuItem
                icon={<Plus size={14} />}
                onSelect={() => {
                  if (!isOpen) toggleFolder(kind, node.path);
                  setEditing({ kind, slug: null, folder: node.path });
                }}
              >{uiText("Novo")} {labels.one} {uiText("aqui")}</MenuItem>
              {node.path.split('/').length < MAX_FOLDER_DEPTH && (
                <MenuItem
                  icon={<FolderPlus size={14} />}
                  onSelect={() => {
                    if (!isOpen) toggleFolder(kind, node.path);
                    setFolderEditing({ kind, parent: node.path });
                  }}
                >{uiText("Nova subpasta")}</MenuItem>
              )}
              <MenuItem icon={<Pencil size={14} />} onSelect={() => setFolderEditing({ kind, parent: folderParent(node.path), rename: node.path })}>{uiText("Renomear pasta")}</MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 size={14} />}
                danger
                onSelect={() => {
                  workspace.deleteFolder(kind, node.path);
                  showToast(uiText("Pasta removida; o conteúdo subiu um nível."));
                }}
              >{uiText("Excluir pasta")}</MenuItem>
            </Menu>
          </span>}
        </Row>
        {isOpen && (
          <div role="group" aria-label={uiText("Pasta {0}", [node.path])} className="ml-[13px] flex flex-col gap-0.5 pl-1.5">
            {folderInput(node.path)}
            {itemInput(node.path)}
            {node.folders.map((child) => renderFolder(child))}
            {node.items.map((item) => renderItem(item))}
          </div>
        )}
      </div>
    );
  };

  const empty = !items.length && !declared.length;
  return (
    <section className="flex flex-col gap-0.5">
      <div className={`flex h-7 items-center justify-between rounded-control pl-1 ${over === '' ? 'bg-accent-soft ring-1 ring-accent/40' : ''}`} {...drop(null)}>
        <button
          type="button"
          aria-expanded={open}
          className="flex h-7 items-center gap-1 rounded-chip px-1 text-caption font-medium text-faint hover:text-ink"
          onClick={() => toggleSection(kind)}
        >
          <ChevronDown size={12} className={open ? '' : '-rotate-90'} />
          {sectionLabel(labels.section, items.length)}
        </button>
        {/* Quiet until the pointer is over the sidebar (or focus reaches it); always there on touch. */}
        {!viewOnly && <span className="flex items-center">
          <IconButton
            label={uiText("Nova pasta de {0}", [labels.section.toLowerCase()])}
            className="h-6 min-w-6 px-1 opacity-0 group-hover/sidebar:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            onClick={() => setFolderEditing({ kind, parent: null })}
          >
            <FolderPlus />
          </IconButton>
          <IconButton
            label={uiText("Novo {0}", [labels.one])}
            className="h-6 min-w-6 px-1 opacity-0 group-hover/sidebar:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            onClick={() => setEditing({ kind, slug: null })}
          >
            <Plus />
          </IconButton>
        </span>}
      </div>
      {open && (
        // The section's content sits under its title: folders and items are children of the section, not siblings of it.
        <div className="ml-[13px] flex flex-col gap-0.5 pl-1.5">
          {folderInput(null)}
          {tree.folders.map((node) => renderFolder(node))}
          {tree.items.map((item) => renderItem(item))}
          {empty && !viewOnly && !creatingItem(undefined) && (
            <button
              type="button"
              className="flex h-8 items-center gap-2 rounded-control pl-2 text-left text-caption text-faint transition-colors hover:bg-panel-2/60 hover:text-muted"
              onClick={() => setEditing({ kind, slug: null })}
            >
              <Plus size={13} /> {uiText("Criar")} {labels.one}
            </button>
          )}
          {itemInput(undefined)}
        </div>
      )}
    </section>
  );
}
