import { commitLabel } from '../actions/labels';
import { uiStore, useUi } from '../ui/uiStore';

export function EditableLabel({ id, text, displayText = text }: { id: string; text: string; displayText?: string }) {
  const editing = useUi((s) => s.editingId === id);
  if (!editing) {
    return (
      <span
        className="strukt-label"
        onDoubleClick={(event) => {
          event.stopPropagation();
          uiStore.setState({ editingId: id });
        }}
      >
        {displayText}
      </span>
    );
  }
  const finish = (value: string | null) => {
    uiStore.setState({ editingId: null });
    if (value !== null) commitLabel(id, value);
  };
  return (
    <input
      className="strukt-label-input nodrag nopan"
      autoFocus
      defaultValue={text}
      size={Math.max(4, text.length)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(event.currentTarget.value);
        if (event.key === 'Escape') finish(null);
      }}
      onBlur={(event) => {
        if (uiStore.getState().editingId === id) finish(event.currentTarget.value);
      }}
    />
  );
}
