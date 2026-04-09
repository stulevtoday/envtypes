import * as vscode from "vscode";
import { EnvScanner } from "./scanner";
import { DiagnosticsProvider } from "./diagnostics";
import { EnvCompletionProvider } from "./completions";
import { EnvHoverProvider } from "./hover";
import { EnvCodeLensProvider } from "./codelens";

let diagnosticsProvider: DiagnosticsProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const scanner = new EnvScanner();
  diagnosticsProvider = new DiagnosticsProvider(scanner);
  const completionProvider = new EnvCompletionProvider(scanner);
  const hoverProvider = new EnvHoverProvider(scanner);
  const codeLensProvider = new EnvCodeLensProvider(scanner);

  context.subscriptions.push(
    diagnosticsProvider,

    vscode.languages.registerCompletionItemProvider(
      { pattern: "**/.env*" },
      completionProvider,
      "="
    ),

    vscode.languages.registerHoverProvider(
      { pattern: "**/.env*" },
      hoverProvider
    ),

    vscode.languages.registerCodeLensProvider(
      { pattern: "**/.env*" },
      codeLensProvider
    ),

    vscode.commands.registerCommand("envtypes.doctor", () => runCliCommand("doctor")),
    vscode.commands.registerCommand("envtypes.scan", () => runCliCommand("scan")),
    vscode.commands.registerCommand("envtypes.generate", () => runCliCommand("generate")),
  );

  if (vscode.workspace.workspaceFolders) {
    scanner.scan(vscode.workspace.workspaceFolders[0].uri.fsPath);
    diagnosticsProvider.refreshAll();
  }

  const watcher = vscode.workspace.createFileSystemWatcher("**/{*.ts,*.tsx,*.js,*.jsx,.env*}");
  watcher.onDidChange(() => debouncedRefresh(scanner));
  watcher.onDidCreate(() => debouncedRefresh(scanner));
  watcher.onDidDelete(() => debouncedRefresh(scanner));
  context.subscriptions.push(watcher);
}

let refreshTimeout: ReturnType<typeof setTimeout> | undefined;

function debouncedRefresh(scanner: EnvScanner) {
  if (refreshTimeout) clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(() => {
    const config = vscode.workspace.getConfiguration("envtypes");
    if (!config.get("scanOnSave", true)) return;
    if (vscode.workspace.workspaceFolders) {
      scanner.scan(vscode.workspace.workspaceFolders[0].uri.fsPath);
      diagnosticsProvider?.refreshAll();
    }
  }, 800);
}

async function runCliCommand(command: string) {
  const terminal = vscode.window.createTerminal("envtypes");
  terminal.show();
  terminal.sendText(`npx envtypes ${command}`);
}

export function deactivate() {}
