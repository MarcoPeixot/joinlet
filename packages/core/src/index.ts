export const STRUKT_FORMAT_VERSION = 1;

export * from './model';
export * from './components';
export * from './shapes';
export * from './ids';
export * from './suggest';
export * from './connector';
export * from './tree';
export * from './applyOps';
export * from './share';
export * from './geometry';
export * from './syncLayout';
export * from './placement';
export * from './snap';
export * from './clipboard';
export * from './diff';
export * from './compare';
export type { ChatTarget, ChatEdit, SketchShape, ChatSearchActivity, ChatWorkspaceItem } from './chatEdit';
export { readChatEdit, sketchEditError } from './chatEdit';
export { splitDiagram } from './splitDiagram';
export type { DiagramPart } from './chatEdit';
export { readChatModel } from './chatModel';
export type { ChatModelChoice } from './chatModel';
export { addCanvasDiagram, canvasFrameOf, canvasFrames, canvasFrameModel, splitCanvasDiagram } from './canvasDiagrams';
export { readWorkspaceOps } from './workspaceEdit';
export type { WorkspaceOp } from './workspaceEdit';

export * from './aiProviders';

export { catalogMatches } from './catalogSearch';
