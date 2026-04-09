import { Project, SyntaxKind, Node } from "ts-morph";
import path from "node:path";
import type { EnvVarUsage, ScanResult } from "./types.js";

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.d.ts",
];

export interface ScanOptions {
  cwd?: string;
  include?: string[];
  exclude?: string[];
}

export function scan(options: ScanOptions = {}): ScanResult {
  const start = performance.now();
  const cwd = options.cwd ?? process.cwd();

  const include = options.include ?? [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.mjs",
    "**/*.cjs",
  ];
  const exclude = options.exclude ?? DEFAULT_IGNORE;

  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const pattern of include) {
    project.addSourceFilesAtPaths(
      path.resolve(cwd, pattern)
    );
  }

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (exclude.some((pattern) => matchGlob(filePath, pattern))) {
      project.removeSourceFile(sourceFile);
    }
  }

  const variables: EnvVarUsage[] = [];
  const files = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = path.relative(cwd, sourceFile.getFilePath());
    const found = extractEnvVars(sourceFile, filePath);
    if (found.length > 0) {
      files.add(filePath);
      variables.push(...found);
    }
  }

  return {
    variables,
    files: [...files],
    duration: performance.now() - start,
  };
}

function extractEnvVars(
  sourceFile: ReturnType<Project["addSourceFileAtPath"]>,
  filePath: string
): EnvVarUsage[] {
  const results: EnvVarUsage[] = [];

  sourceFile.forEachDescendant((node) => {
    if (node.isKind(SyntaxKind.PropertyAccessExpression)) {
      // process.env.VAR_NAME
      const dotResult = matchDotAccess(node, filePath);
      if (dotResult) { results.push(dotResult); return; }

      // import.meta.env.VAR_NAME (Vite/Astro)
      const metaResult = matchImportMetaEnv(node, filePath);
      if (metaResult) { results.push(metaResult); return; }

      // Deno.env.get("VAR") handled below in CallExpression
    }

    // process.env['VAR_NAME'] or process.env["VAR_NAME"] or import.meta.env["VAR"]
    if (node.isKind(SyntaxKind.ElementAccessExpression)) {
      const result = matchBracketAccess(node, filePath);
      if (result) results.push(result);
    }

    // const { VAR_NAME } = process.env
    if (node.isKind(SyntaxKind.VariableDeclaration)) {
      const found = matchDestructuring(node, filePath);
      results.push(...found);
    }

    // Deno.env.get("VAR"), Deno.env.toObject(), Bun.env.VAR
    if (node.isKind(SyntaxKind.CallExpression)) {
      const found = matchRuntimeEnvCall(node, filePath);
      results.push(...found);
    }
  });

  return results;
}

function matchDotAccess(node: Node, filePath: string): EnvVarUsage | null {
  const text = node.getText();
  // process.env.VAR or Bun.env.VAR
  const match = text.match(/^(?:process|Bun)\.env\.([A-Z_][A-Z0-9_]*)$/);
  if (!match) return null;

  const { line, column } = sourcePosition(node);
  const { hasDefault, defaultValue } = detectDefault(node);

  return {
    name: match[1],
    filePath,
    line,
    column,
    accessPattern: "dot",
    hasDefault,
    defaultValue,
  };
}

function matchBracketAccess(node: Node, filePath: string): EnvVarUsage | null {
  const text = node.getText();
  // process.env["VAR"], Bun.env["VAR"], import.meta.env["VAR"]
  const match = text.match(
    /^(?:process|Bun)\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]$/
  ) ?? text.match(
    /^import\.meta\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]$/
  );
  if (!match) return null;

  const { line, column } = sourcePosition(node);
  const { hasDefault, defaultValue } = detectDefault(node);

  return {
    name: match[1],
    filePath,
    line,
    column,
    accessPattern: "bracket",
    hasDefault,
    defaultValue,
  };
}

function matchDestructuring(
  node: Node,
  filePath: string
): EnvVarUsage[] {
  const results: EnvVarUsage[] = [];
  const declaration = node.asKind(SyntaxKind.VariableDeclaration);
  if (!declaration) return results;

  const initializer = declaration.getInitializer();
  const initText = initializer?.getText();
  if (!initText || (initText !== "process.env" && initText !== "Bun.env")) return results;

  const nameNode = declaration.getNameNode();
  if (!nameNode.isKind(SyntaxKind.ObjectBindingPattern)) return results;

  for (const element of nameNode.getElements()) {
    const propertyName =
      element.getPropertyNameNode()?.getText() ?? element.getName();
    const initializerNode = element.getInitializer();
    const { line, column } = sourcePosition(element);

    results.push({
      name: propertyName,
      filePath,
      line,
      column,
      accessPattern: "destructure",
      hasDefault: !!initializerNode,
      defaultValue: initializerNode?.getText().replace(/^['"]|['"]$/g, ""),
    });
  }

  return results;
}

function matchImportMetaEnv(
  node: Node,
  filePath: string
): EnvVarUsage | null {
  const text = node.getText();
  const match = text.match(
    /^import\.meta\.env\.([A-Z_][A-Z0-9_]*)$/
  );
  if (!match) return null;

  const { line, column } = sourcePosition(node);
  const { hasDefault, defaultValue } = detectDefault(node);

  return {
    name: match[1],
    filePath,
    line,
    column,
    accessPattern: "dot",
    hasDefault,
    defaultValue,
  };
}

function matchRuntimeEnvCall(node: Node, filePath: string): EnvVarUsage[] {
  const results: EnvVarUsage[] = [];
  const text = node.getText();

  // Deno.env.get("VAR_NAME")
  const denoMatch = text.match(
    /^Deno\.env\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\)$/
  );
  if (denoMatch) {
    const { line, column } = sourcePosition(node);
    const { hasDefault, defaultValue } = detectDefault(node);
    results.push({
      name: denoMatch[1],
      filePath,
      line,
      column,
      accessPattern: "bracket",
      hasDefault,
      defaultValue,
    });
  }

  return results;
}

function detectDefault(node: Node): {
  hasDefault: boolean;
  defaultValue?: string;
} {
  const parent = node.getParent();
  if (!parent) return { hasDefault: false };

  // process.env.X || 'default' or process.env.X ?? 'default'
  if (parent.isKind(SyntaxKind.BinaryExpression)) {
    const operator = parent.getOperatorToken().getText();
    if (operator === "||" || operator === "??") {
      const right = parent.getRight().getText().replace(/^['"]|['"]$/g, "");
      return { hasDefault: true, defaultValue: right };
    }
  }

  // condition ? process.env.X : 'default' (ternary — detect if node is the "when true" branch)
  if (parent.isKind(SyntaxKind.ConditionalExpression)) {
    const whenFalse = parent.getWhenFalse().getText().replace(/^['"]|['"]$/g, "");
    if (whenFalse && !whenFalse.includes("process.env") && !whenFalse.includes("import.meta.env")) {
      return { hasDefault: true, defaultValue: whenFalse };
    }
  }

  return { hasDefault: false };
}

function sourcePosition(node: Node): { line: number; column: number } {
  const start = node.getStartLineNumber();
  const pos = node.getStartLinePos();
  return {
    line: start,
    column: node.getStart() - pos + 1,
  };
}

function matchGlob(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\./g, "\\.")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(regex).test(filePath);
}
