import * as vscode from "vscode";
import { EnvScanner } from "./scanner";

export class DiagnosticsProvider implements vscode.Disposable {
  private collection: vscode.DiagnosticCollection;
  private scanner: EnvScanner;
  private disposables: vscode.Disposable[] = [];

  constructor(scanner: EnvScanner) {
    this.scanner = scanner;
    this.collection = vscode.languages.createDiagnosticCollection("envtypes");

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.check(doc)),
      vscode.workspace.onDidSaveTextDocument((doc) => this.check(doc)),
      vscode.workspace.onDidChangeTextDocument((e) => this.check(e.document)),
    );
  }

  refreshAll() {
    for (const doc of vscode.workspace.textDocuments) {
      this.check(doc);
    }
  }

  private check(document: vscode.TextDocument) {
    if (!this.isEnvFile(document)) return;

    const config = vscode.workspace.getConfiguration("envtypes");
    if (!config.get("enable", true)) return;

    const diagnostics: vscode.Diagnostic[] = [];
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return;

    const text = document.getText();
    const lines = text.split("\n");
    const defined = new Map<string, number>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) continue;
      const stripped = line.startsWith("export ") ? line.slice(7) : line;
      const eq = stripped.indexOf("=");
      if (eq === -1) continue;

      const key = stripped.slice(0, eq).trim();
      const value = stripped.slice(eq + 1).trim();
      defined.set(key, i);

      const varInfo = this.scanner.variables.get(key);

      if (!varInfo) {
        const range = this.getKeyRange(document, i, key);
        const diag = new vscode.Diagnostic(
          range,
          `${key} is defined but not referenced in code`,
          vscode.DiagnosticSeverity.Hint
        );
        diag.source = "envtypes";
        diag.tags = [vscode.DiagnosticTag.Unnecessary];
        diagnostics.push(diag);
        continue;
      }

      const typeError = this.validateType(key, value, varInfo.type);
      if (typeError) {
        const range = this.getValueRange(document, i, eq, line);
        const diag = new vscode.Diagnostic(
          range,
          typeError,
          vscode.DiagnosticSeverity.Error
        );
        diag.source = "envtypes";
        diagnostics.push(diag);
      }
    }

    // Missing required vars
    for (const [name, info] of this.scanner.variables) {
      if (info.required && !info.defaultValue && !defined.has(name)) {
        const range = new vscode.Range(0, 0, 0, 0);
        const diag = new vscode.Diagnostic(
          range,
          `Missing required variable: ${name} (${info.type})`,
          vscode.DiagnosticSeverity.Error
        );
        diag.source = "envtypes";
        diagnostics.push(diag);
      }
    }

    // Security issues
    for (const issue of this.scanner.securityIssues) {
      const lineIdx = defined.get(issue.variable);
      if (lineIdx === undefined) continue;

      const range = this.getKeyRange(document, lineIdx, issue.variable);
      const severity = issue.severity === "critical"
        ? vscode.DiagnosticSeverity.Error
        : issue.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

      const diag = new vscode.Diagnostic(range, issue.message, severity);
      diag.source = "envtypes";
      if (issue.suggestion) {
        diag.message += `\n${issue.suggestion}`;
      }
      diagnostics.push(diag);
    }

    this.collection.set(document.uri, diagnostics);
  }

  private validateType(name: string, rawValue: string, type: string): string | null {
    let value = rawValue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value) return null;

    switch (type) {
      case "port": {
        const n = Number(value);
        if (isNaN(n) || n < 0 || n > 65535 || !Number.isInteger(n))
          return `${name}: expected port (0-65535), got "${value}"`;
        return null;
      }
      case "number":
      case "integer": {
        const n = Number(value);
        if (isNaN(n)) return `${name}: expected number, got "${value}"`;
        if (type === "integer" && !Number.isInteger(n)) return `${name}: expected integer, got "${value}"`;
        return null;
      }
      case "boolean": {
        if (!["true", "false", "1", "0", "yes", "no"].includes(value.toLowerCase()))
          return `${name}: expected boolean (true/false/1/0/yes/no), got "${value}"`;
        return null;
      }
      case "url": {
        try { new URL(value); return null; } catch {
          return `${name}: expected valid URL, got "${value}"`;
        }
      }
      case "email": {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
          return `${name}: expected email, got "${value}"`;
        return null;
      }
      default: return null;
    }
  }

  private isEnvFile(doc: vscode.TextDocument): boolean {
    const name = doc.uri.path.split("/").pop() ?? "";
    return name.startsWith(".env");
  }

  private getKeyRange(doc: vscode.TextDocument, lineIdx: number, key: string): vscode.Range {
    const lineText = doc.lineAt(lineIdx).text;
    const start = lineText.indexOf(key);
    return new vscode.Range(lineIdx, Math.max(0, start), lineIdx, Math.max(0, start) + key.length);
  }

  private getValueRange(doc: vscode.TextDocument, lineIdx: number, eqPos: number, _line: string): vscode.Range {
    const lineText = doc.lineAt(lineIdx).text;
    const eqInLine = lineText.indexOf("=");
    return new vscode.Range(lineIdx, eqInLine + 1, lineIdx, lineText.length);
  }

  dispose() {
    this.collection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
