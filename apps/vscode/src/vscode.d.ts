/**
 * The slice of the VS Code API this extension uses. @types/vscode is not a dependency (no new packages);
 * if it is ever added, delete this file: the signatures below follow the real API.
 */
declare module 'vscode' {
  export interface Disposable {
    dispose(): void;
  }
  export type Event<T> = (listener: (event: T) => unknown) => Disposable;

  export class Range {
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  }
  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
  }
  export class Diagnostic {
    constructor(range: Range, message: string, severity?: DiagnosticSeverity);
    source?: string;
  }
  export class Uri {
    static file(path: string): Uri;
    static parse(value: string): Uri;
    readonly scheme: string;
    readonly fsPath: string;
    toString(): string;
  }
  export interface TextDocument {
    readonly uri: Uri;
    getText(): string;
  }
  export interface DiagnosticCollection extends Disposable {
    set(uri: Uri, diagnostics: readonly Diagnostic[] | undefined): void;
    delete(uri: Uri): void;
    clear(): void;
  }
  export interface OutputChannel extends Disposable {
    appendLine(line: string): void;
  }
  export interface ConfigurationChangeEvent {
    affectsConfiguration(section: string): boolean;
  }
  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
  }
  export enum ProgressLocation {
    Notification = 15,
  }
  export interface ExtensionContext {
    readonly subscriptions: Disposable[];
  }

  export namespace workspace {
    const isTrusted: boolean;
    const textDocuments: readonly TextDocument[];
    function getConfiguration(section: string): WorkspaceConfiguration;
    function findFiles(include: string, exclude?: string): PromiseLike<Uri[]>;
    function openTextDocument(options: { language?: string; content?: string }): PromiseLike<TextDocument>;
    const onDidOpenTextDocument: Event<TextDocument>;
    const onDidCloseTextDocument: Event<TextDocument>;
    const onDidChangeTextDocument: Event<{ document: TextDocument }>;
    const onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
    const onDidGrantWorkspaceTrust: Event<void>;
  }
  export namespace window {
    const activeTextEditor: { document: TextDocument } | undefined;
    function createOutputChannel(name: string): OutputChannel;
    function showInformationMessage(message: string): PromiseLike<string | undefined>;
    function showWarningMessage(message: string): PromiseLike<string | undefined>;
    function showErrorMessage(message: string): PromiseLike<string | undefined>;
    function showQuickPick(items: readonly string[], options?: { placeHolder?: string }): PromiseLike<string | undefined>;
    function showTextDocument(document: TextDocument): PromiseLike<unknown>;
    function withProgress<T>(options: { location: ProgressLocation; title: string }, task: () => PromiseLike<T>): PromiseLike<T>;
  }
  export namespace languages {
    function createDiagnosticCollection(name?: string): DiagnosticCollection;
  }
  export namespace commands {
    function registerCommand(command: string, callback: () => unknown): Disposable;
    function executeCommand(command: string, ...args: unknown[]): PromiseLike<unknown>;
  }
  export namespace env {
    function openExternal(target: Uri): PromiseLike<boolean>;
  }
}
