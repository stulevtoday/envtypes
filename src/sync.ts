import fs from "node:fs";
import path from "node:path";
import type { EnvVarSchema } from "./types.js";

export interface SyncResult {
  inSync: boolean;
  missingFromExample: string[];
  extraInExample: string[];
  staleDefaults: StaleDefault[];
}

export interface StaleDefault {
  variable: string;
  exampleValue: string;
  schemaDefault: string;
}

export function checkExampleSync(
  schemas: EnvVarSchema[],
  examplePath: string
): SyncResult | null {
  if (!fs.existsSync(examplePath)) return null;

  const exampleVars = parseExampleFile(examplePath);
  const schemaNames = new Set(schemas.map((s) => s.name));
  const exampleNames = new Set(exampleVars.keys());

  const missingFromExample = schemas
    .filter((s) => s.required && !exampleNames.has(s.name))
    .map((s) => s.name);

  const extraInExample = [...exampleNames]
    .filter((n) => !schemaNames.has(n));

  const staleDefaults: StaleDefault[] = [];
  for (const schema of schemas) {
    if (schema.defaultValue === undefined) continue;
    const exampleVal = exampleVars.get(schema.name);
    if (exampleVal !== undefined && exampleVal !== schema.defaultValue) {
      staleDefaults.push({
        variable: schema.name,
        exampleValue: exampleVal,
        schemaDefault: schema.defaultValue,
      });
    }
  }

  return {
    inSync: missingFromExample.length === 0 && extraInExample.length === 0 && staleDefaults.length === 0,
    missingFromExample,
    extraInExample,
    staleDefaults,
  };
}

function parseExampleFile(filePath: string): Map<string, string> {
  const vars = new Map<string, string>();
  const content = fs.readFileSync(filePath, "utf-8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Active variable: KEY=value
    const activeMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (activeMatch) {
      vars.set(activeMatch[1], activeMatch[2]);
      continue;
    }

    // Commented variable: # KEY=value or # KEY=value (default: x)
    const commentMatch = trimmed.match(/^#\s*([A-Z_][A-Z0-9_]*)=([^\s(]*)/);
    if (commentMatch) {
      vars.set(commentMatch[1], commentMatch[2]);
    }
  }

  return vars;
}

export function findExampleFile(cwd: string): string | null {
  const candidates = [".env.example", ".env.sample", ".env.template"];
  for (const name of candidates) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
