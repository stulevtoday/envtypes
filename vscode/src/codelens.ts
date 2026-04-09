import * as vscode from "vscode";
import { EnvScanner } from "./scanner";

export class EnvCodeLensProvider implements vscode.CodeLensProvider {
  private scanner: EnvScanner;
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(scanner: EnvScanner) {
    this.scanner = scanner;
  }

  refresh() {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const name = document.uri.path.split("/").pop() ?? "";
    if (!name.startsWith(".env")) return [];

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return [];

    const lenses: vscode.CodeLens[] = [];
    const range = new vscode.Range(0, 0, 0, 0);

    const varCount = this.scanner.variables.size;
    const missing = this.scanner.getMissingVars(cwd);
    const extra = this.scanner.getExtraVars(cwd);
    const securityCount = this.scanner.securityIssues.filter(
      (i) => i.severity === "critical"
    ).length;

    const parts: string[] = [];
    parts.push(`${varCount} variables in codebase`);
    if (missing.length > 0) parts.push(`${missing.length} missing`);
    if (extra.length > 0) parts.push(`${extra.length} unused`);
    if (securityCount > 0) parts.push(`${securityCount} security issues`);

    lenses.push(new vscode.CodeLens(range, {
      title: `envtypes: ${parts.join(" · ")}`,
      command: "envtypes.doctor",
    }));

    return lenses;
  }
}
