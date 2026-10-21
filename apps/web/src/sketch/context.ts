/** Send drawing geometry and text to the assistant; embedded binary files stay in the workspace. */
export function sketchContext(text: string): string {
  try {
    const scene = JSON.parse(text);
    const keys = ['id','type','x','y','width','height','angle','text','strokeColor','backgroundColor','fontSize','points','startBinding','endBinding','containerId','boundElements','fileId'];
    return JSON.stringify({ elements: (scene.elements ?? []).filter((el: { isDeleted?: boolean }) => !el.isDeleted).map((el: Record<string, unknown>) => Object.fromEntries(keys.filter((key) => el[key] !== undefined).map((key) => [key, el[key]]))) });
  } catch { return '{"elements":[]}'; }
}
