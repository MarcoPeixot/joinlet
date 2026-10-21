/** Sketch preview for a Overview card; loads Excalidraw on demand (best effort: `null` on any failure). */
export async function sketchThumbnail(text: string): Promise<string | null> {
  try {
    const scene = JSON.parse(text) as { elements?: { isDeleted?: boolean }[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
    const elements = (scene.elements ?? []).filter((el) => !el.isDeleted);
    if (!elements.length) return null;
    const { exportToSvg } = await import('@excalidraw/excalidraw');
    const svg = await exportToSvg({
      elements: elements as never,
      appState: { ...scene.appState, exportBackground: false },
      files: (scene.files ?? {}) as never,
      exportPadding: 12,
      skipInliningFonts: true,
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  } catch {
    return null;
  }
}
