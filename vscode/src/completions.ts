import * as vscode from "vscode";
import { EnvScanner } from "./scanner";

export class EnvCompletionProvider implements vscode.CompletionItemProvider {
  private scanner: EnvScanner;

  constructor(scanner: EnvScanner) {
    this.scanner = scanner;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const lineText = document.lineAt(position).text;
    const textBefore = lineText.slice(0, position.character);

    // Already has `=` — suggest a value based on type
    if (textBefore.includes("=")) {
      return this.suggestValues(textBefore);
    }

    // Suggest variable names that exist in code but not yet in this file
    return this.suggestVariableNames(document);
  }

  private suggestVariableNames(document: vscode.TextDocument): vscode.CompletionItem[] {
    const text = document.getText();
    const defined = new Set<string>();

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const stripped = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
      const eq = stripped.indexOf("=");
      if (eq > 0) defined.add(stripped.slice(0, eq).trim());
    }

    const items: vscode.CompletionItem[] = [];

    for (const [name, info] of this.scanner.variables) {
      if (defined.has(name)) continue;

      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
      item.detail = `${info.type}${info.required ? " (required)" : " (optional)"}`;
      item.insertText = `${name}=${this.exampleValue(info.type, name)}`;

      const docs = new vscode.MarkdownString();
      docs.appendMarkdown(`**Type:** \`${info.type}\`\n\n`);
      if (info.defaultValue) docs.appendMarkdown(`**Default:** \`${info.defaultValue}\`\n\n`);
      if (info.files.length > 0) {
        docs.appendMarkdown(`**Used in:** ${info.files.map(f => `\`${f.path}:${f.line}\``).join(", ")}\n`);
      }
      item.documentation = docs;

      item.sortText = info.required ? "0" + name : "1" + name;
      items.push(item);
    }

    return items;
  }

  private suggestValues(textBefore: string): vscode.CompletionItem[] {
    const key = textBefore.split("=")[0].trim().replace(/^export\s+/, "");
    const info = this.scanner.variables.get(key);
    if (!info) return [];

    const items: vscode.CompletionItem[] = [];

    if (info.type === "boolean") {
      for (const val of ["true", "false"]) {
        const item = new vscode.CompletionItem(val, vscode.CompletionItemKind.Value);
        items.push(item);
      }
    } else if (info.type === "enum") {
      for (const val of ["development", "production", "test", "staging"]) {
        items.push(new vscode.CompletionItem(val, vscode.CompletionItemKind.EnumMember));
      }
    }

    if (info.defaultValue) {
      const item = new vscode.CompletionItem(
        info.defaultValue,
        vscode.CompletionItemKind.Value
      );
      item.detail = "default value";
      item.sortText = "0";
      items.push(item);
    }

    return items;
  }

  private exampleValue(type: string, name: string): string {
    switch (type) {
      case "port": return "3000";
      case "url": return "https://";
      case "email": return "user@example.com";
      case "boolean": return "true";
      case "number":
      case "integer": return "0";
      case "enum": return name === "NODE_ENV" ? "development" : "";
      default: return "";
    }
  }
}
