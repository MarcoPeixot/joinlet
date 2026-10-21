import * as vscode from 'vscode';
import { checkWorkspaceCommand, COMMAND_IDS, diffCommand, openCommand, readSettings } from './commands';
import type { Host } from './commands';
import { diagnoseDiagramText } from './diagnostics';
import type { EditorDiagnostic } from './diagnostics';
import { nodeExec } from './nodeExec';
import { isDiagramFile } from './schema';

const LIVE_DEBOUNCE_MS = 250;

const toVscode = (diagnostics: readonly EditorDiagnostic[]): vscode.Diagnostic[] =>
  diagnostics.map((d) => {
    const diagnostic = new vscode.Diagnostic(new vscode.Range(d.startLine, d.startCharacter, d.endLine, d.endCharacter), d.message, d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
    diagnostic.source = 'Joinlet';
    return diagnostic;
  });

/**
 * Wiring only: the logic lives in the pure modules next to this file (and is tested there).
 * Not exercised in a real VS Code instance by the unit suite; see CONTRIBUTING.md for validation requirements.
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Joinlet');
  const checkDiagnostics = vscode.languages.createDiagnosticCollection('strukt-check');
  const liveDiagnostics = vscode.languages.createDiagnosticCollection('strukt-live');
  const config = () => vscode.workspace.getConfiguration('strukt');
  const liveEnabled = () => config().get<boolean>('liveDiagnostics') !== false;

  const host: Host = {
    get isTrusted() {
      return vscode.workspace.isTrusted;
    },
    settings: () => readSettings((key) => config().get(key)),
    findManifests: async () => (await vscode.workspace.findFiles('**/.arch/strukt.json', '**/node_modules/**')).map((uri) => uri.fsPath),
    activeFile: () => vscode.window.activeTextEditor?.document.uri.fsPath,
    chooseRoot: (roots) => Promise.resolve(vscode.window.showQuickPick(roots, { placeHolder: 'Qual workspace do Joinlet?' })),
    exec: (command, args, options) => {
      output.appendLine(`$ ${command} ${args.join(' ')}`);
      return nodeExec(command, args, options);
    },
    setCheckDiagnostics: (files) => {
      checkDiagnostics.clear();
      for (const [path, diagnostics] of files) {
        const uri = vscode.Uri.file(path);
        // An open diagram already has live (and fresher) diagnostics from the same parser.
        if (liveEnabled() && isDiagramFile(path) && vscode.workspace.textDocuments.some((doc) => doc.uri.fsPath === uri.fsPath)) continue;
        checkDiagnostics.set(uri, toVscode(diagnostics));
      }
    },
    info: (message) => void vscode.window.showInformationMessage(message),
    warn: (message) => void vscode.window.showWarningMessage(message),
    error: (message) => {
      output.appendLine(message);
      void vscode.window.showErrorMessage(message);
    },
    showMarkdown: async (markdown) => {
      const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
      await vscode.window.showTextDocument(document);
      try {
        await vscode.commands.executeCommand('markdown.showPreview', document.uri);
      } catch {
        // The raw Markdown stays open when the built-in preview is unavailable.
      }
    },
    openExternal: (url) => Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))),
  };

  const run = (task: (host: Host) => Promise<void>, title: string) => () =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => task(host).catch((error: unknown) => host.error(`Joinlet: ${error instanceof Error ? error.message : String(error)}`)));
  const [checkId, diffId, openId] = COMMAND_IDS;
  context.subscriptions.push(
    output,
    checkDiagnostics,
    liveDiagnostics,
    vscode.commands.registerCommand(checkId, run(checkWorkspaceCommand, 'Joinlet: validando o workspace')),
    vscode.commands.registerCommand(diffId, run(diffCommand, 'Joinlet: comparando com o git')),
    vscode.commands.registerCommand(openId, () => openCommand(host)),
  );

  // Live diagnostics for open *.strukt.json: same parser as the app and the CLI, no process spawned.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const validate = (document: vscode.TextDocument): void => {
    if (document.uri.scheme !== 'file' || !isDiagramFile(document.uri.fsPath)) return;
    if (!liveEnabled()) return void liveDiagnostics.delete(document.uri);
    liveDiagnostics.set(document.uri, toVscode(diagnoseDiagramText(document.getText())));
    checkDiagnostics.delete(document.uri);
  };
  const validateSoon = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => (timers.delete(key), validate(document)), LIVE_DEBOUNCE_MS));
  };
  for (const document of vscode.workspace.textDocuments) validate(document);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((event) => validateSoon(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearTimeout(timers.get(document.uri.toString()));
      timers.delete(document.uri.toString());
      liveDiagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('strukt.liveDiagnostics')) return;
      liveDiagnostics.clear();
      for (const document of vscode.workspace.textDocuments) validate(document);
    }),
    { dispose: () => timers.forEach((timer) => clearTimeout(timer)) },
  );
}

export function deactivate(): void {}
