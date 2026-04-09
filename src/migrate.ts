import fs from "node:fs";
import path from "node:path";
import { Project, SyntaxKind, type ObjectLiteralExpression } from "ts-morph";
import type { EnvVarSchema, InferredType } from "./types.js";

export type MigrateSource = "envalid" | "znv" | "t3-env";

export interface MigrateResult {
  source: MigrateSource;
  schemas: EnvVarSchema[];
  sourceFile: string;
}

export function detectMigrationSource(cwd: string): MigrateSource | null {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["envalid"]) return "envalid";
    if (deps["znv"]) return "znv";
    if (deps["@t3-oss/env-core"] || deps["@t3-oss/env-nextjs"]) return "t3-env";
  } catch {}

  return null;
}

export function migrateFromSource(cwd: string, source: MigrateSource): MigrateResult | null {
  switch (source) {
    case "envalid": return migrateEnvalid(cwd);
    case "znv": return migrateZnv(cwd);
    case "t3-env": return migrateT3Env(cwd);
  }
}

function migrateEnvalid(cwd: string): MigrateResult | null {
  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });

  const patterns = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];
  for (const p of patterns) {
    project.addSourceFilesAtPaths(path.resolve(cwd, p));
  }

  for (const sf of project.getSourceFiles()) {
    const fp = sf.getFilePath();
    if (fp.includes("node_modules")) { project.removeSourceFile(sf); continue; }

    const text = sf.getFullText();
    if (!text.includes("cleanEnv") && !text.includes("envalid")) continue;

    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const funcName = call.getExpression().getText();
      if (!funcName.includes("cleanEnv")) continue;

      const args = call.getArguments();
      // cleanEnv(process.env, { ... })
      const schemaArg = args.length >= 2 ? args[1] : null;
      if (!schemaArg || !schemaArg.isKind(SyntaxKind.ObjectLiteralExpression)) continue;

      const schemas = parseEnvalidSchema(schemaArg as ObjectLiteralExpression);
      if (schemas.length > 0) {
        return {
          source: "envalid",
          schemas,
          sourceFile: path.relative(cwd, fp),
        };
      }
    }
  }

  return null;
}

function parseEnvalidSchema(obj: ObjectLiteralExpression): EnvVarSchema[] {
  const schemas: EnvVarSchema[] = [];

  for (const prop of obj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
    const name = prop.getName();
    const init = prop.getInitializer();
    if (!init) continue;

    const text = init.getText();
    const type = inferEnvalidType(text);
    const hasDefault = text.includes("default:");
    const description = extractStringOption(text, "desc") ?? extractStringOption(text, "docs");

    schemas.push({
      name,
      type,
      required: !hasDefault && !text.includes("devDefault:"),
      defaultValue: hasDefault ? (extractStringOption(text, "default") ?? undefined) : undefined,
      description: description ?? undefined,
    });
  }

  return schemas;
}

function inferEnvalidType(text: string): InferredType {
  if (text.includes("str(")) return "string";
  if (text.includes("num(")) return "number";
  if (text.includes("bool(")) return "boolean";
  if (text.includes("port(")) return "port";
  if (text.includes("url(")) return "url";
  if (text.includes("email(")) return "email";
  if (text.includes("json(")) return "string";
  if (text.includes("host(")) return "string";
  return "string";
}

function extractStringOption(text: string, key: string): string | null {
  const patterns = [
    new RegExp(`${key}:\\s*["']([^"']+)["']`),
    new RegExp(`${key}:\\s*\`([^\`]+)\``),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

function migrateZnv(cwd: string): MigrateResult | null {
  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });

  const patterns = ["**/*.ts", "**/*.tsx"];
  for (const p of patterns) {
    project.addSourceFilesAtPaths(path.resolve(cwd, p));
  }

  for (const sf of project.getSourceFiles()) {
    const fp = sf.getFilePath();
    if (fp.includes("node_modules")) { project.removeSourceFile(sf); continue; }

    const text = sf.getFullText();
    if (!text.includes("parseEnv") && !text.includes("znv")) continue;

    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const funcName = call.getExpression().getText();
      if (!funcName.includes("parseEnv")) continue;

      const args = call.getArguments();
      const schemaArg = args.length >= 2 ? args[1] : null;
      if (!schemaArg || !schemaArg.isKind(SyntaxKind.ObjectLiteralExpression)) continue;

      const schemas = parseZnvSchema(schemaArg as ObjectLiteralExpression);
      if (schemas.length > 0) {
        return { source: "znv", schemas, sourceFile: path.relative(cwd, fp) };
      }
    }
  }

  return null;
}

function parseZnvSchema(obj: ObjectLiteralExpression): EnvVarSchema[] {
  const schemas: EnvVarSchema[] = [];

  for (const prop of obj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
    const name = prop.getName();
    const init = prop.getInitializer();
    if (!init) continue;

    const text = init.getText();
    const type = inferZnvType(text);

    schemas.push({
      name,
      type,
      required: !text.includes(".optional()") && !text.includes(".default("),
      description: extractStringOption(text, "description") ?? undefined,
    });
  }

  return schemas;
}

function inferZnvType(text: string): InferredType {
  if (text.includes("z.string")) return "string";
  if (text.includes("z.number")) return "number";
  if (text.includes("z.boolean")) return "boolean";
  if (text.includes("z.enum")) return "enum";
  if (text.includes("z.url") || text.includes(".url()")) return "url";
  return "string";
}

function migrateT3Env(cwd: string): MigrateResult | null {
  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const p of ["**/*.ts", "**/*.mjs"]) {
    project.addSourceFilesAtPaths(path.resolve(cwd, p));
  }

  for (const sf of project.getSourceFiles()) {
    const fp = sf.getFilePath();
    if (fp.includes("node_modules")) { project.removeSourceFile(sf); continue; }

    const text = sf.getFullText();
    if (!text.includes("createEnv") && !text.includes("@t3-oss")) continue;

    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const funcName = call.getExpression().getText();
      if (!funcName.includes("createEnv")) continue;

      const args = call.getArguments();
      if (args.length === 0 || !args[0].isKind(SyntaxKind.ObjectLiteralExpression)) continue;

      const configObj = args[0] as ObjectLiteralExpression;
      const schemas: EnvVarSchema[] = [];

      for (const prop of configObj.getProperties()) {
        if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
        const sectionName = prop.getName();
        if (sectionName !== "server" && sectionName !== "client") continue;

        const sectionInit = prop.getInitializer();
        if (!sectionInit || !sectionInit.isKind(SyntaxKind.ObjectLiteralExpression)) continue;

        for (const envProp of (sectionInit as ObjectLiteralExpression).getProperties()) {
          if (!envProp.isKind(SyntaxKind.PropertyAssignment)) continue;
          const envName = envProp.getName();
          const envInit = envProp.getInitializer();
          if (!envInit) continue;
          const envText = envInit.getText();

          schemas.push({
            name: envName,
            type: inferZnvType(envText),
            required: !envText.includes(".optional()"),
            scope: sectionName === "client" ? "client" : "server",
          });
        }
      }

      if (schemas.length > 0) {
        return { source: "t3-env", schemas, sourceFile: path.relative(cwd, fp) };
      }
    }
  }

  return null;
}
