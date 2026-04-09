import * as vscode from "vscode";
import { EnvScanner } from "./scanner";

export class EnvHoverProvider implements vscode.HoverProvider {
  private scanner: EnvScanner;

  constructor(scanner: EnvScanner) {
    this.scanner = scanner;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | null {
    const lineText = document.lineAt(position).text.trim();
    if (!lineText || lineText.startsWith("#")) return null;

    const stripped = lineText.startsWith("export ") ? lineText.slice(7) : lineText;
    const eq = stripped.indexOf("=");
    if (eq === -1) return null;

    const key = stripped.slice(0, eq).trim();
    const keyStart = lineText.indexOf(key);
    const keyEnd = keyStart + key.length;

    if (position.character < keyStart || position.character > keyEnd) return null;

    const info = this.scanner.variables.get(key);
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    if (info) {
      md.appendMarkdown(`### \`${key}\`\n\n`);
      md.appendMarkdown(`| | |\n|---|---|\n`);
      md.appendMarkdown(`| **Type** | \`${info.type}\` |\n`);
      md.appendMarkdown(`| **Required** | ${info.required ? "yes" : "no"} |\n`);

      if (info.defaultValue) {
        md.appendMarkdown(`| **Default** | \`${info.defaultValue}\` |\n`);
      }

      if (info.scope && info.scope !== "unknown") {
        md.appendMarkdown(`| **Scope** | ${info.scope} |\n`);
      }

      if (info.files.length > 0) {
        md.appendMarkdown(`\n**Referenced in:**\n`);
        for (const f of info.files.slice(0, 5)) {
          md.appendMarkdown(`- \`${f.path}:${f.line}\`\n`);
        }
        if (info.files.length > 5) {
          md.appendMarkdown(`- _...and ${info.files.length - 5} more_\n`);
        }
      }
    } else {
      md.appendMarkdown(`### \`${key}\`\n\n`);
      md.appendMarkdown(`_Not referenced in code_ — this variable may be unused.\n`);
    }

    const securityIssue = this.scanner.securityIssues.find((i) => i.variable === key);
    if (securityIssue) {
      const icon = securityIssue.severity === "critical" ? "$(error)" : "$(warning)";
      md.appendMarkdown(`\n---\n${icon} **Security:** ${securityIssue.message}\n`);
      if (securityIssue.suggestion) {
        md.appendMarkdown(`\n> ${securityIssue.suggestion}\n`);
      }
    }

    return new vscode.Hover(md);
  }
}
