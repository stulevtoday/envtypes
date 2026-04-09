import fs from "node:fs";
import path from "node:path";
import type {
  EnvVarSchema,
  InferredType,
  ValidationError,
  ValidationResult,
} from "./types.js";

export function parseEnvFile(filePath: string): Map<string, string> {
  const env = new Map<string, string>();
  if (!fs.existsSync(filePath)) return env;

  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env.set(key, value);
  }

  return env;
}

export function validate(
  schemas: EnvVarSchema[],
  envValues: Map<string, string>
): ValidationResult {
  const errors: ValidationError[] = [];
  const missing: string[] = [];
  const typeErrors: string[] = [];
  const schemaNames = new Set(schemas.map((s) => s.name));
  const extra: string[] = [];

  for (const schema of schemas) {
    const value = envValues.get(schema.name);

    if (value === undefined || value === "") {
      if (schema.required && schema.defaultValue === undefined) {
        missing.push(schema.name);
        errors.push({
          variable: schema.name,
          message: `Missing required variable: ${schema.name}`,
          severity: "error",
        });
      }
      continue;
    }

    const typeError = validateType(schema.name, value, schema.type, schema.enumValues);
    if (typeError) {
      typeErrors.push(schema.name);
      errors.push({
        variable: schema.name,
        message: typeError,
        severity: "error",
      });
    }
  }

  for (const [key] of envValues) {
    if (!schemaNames.has(key)) {
      extra.push(key);
      errors.push({
        variable: key,
        message: `Variable ${key} is defined in .env but not in schema`,
        severity: "warning",
      });
    }
  }

  return {
    valid: missing.length === 0 && typeErrors.length === 0,
    errors,
    missing,
    extra,
    typeErrors,
  };
}

function validateType(
  name: string,
  value: string,
  type: InferredType,
  enumValues?: string[]
): string | null {
  switch (type) {
    case "number": {
      const n = Number(value);
      if (isNaN(n)) {
        return `${name} should be a number, got "${value}"`;
      }
      return null;
    }

    case "port": {
      const n = Number(value);
      if (isNaN(n) || n < 0 || n > 65535 || !Number.isInteger(n)) {
        return `${name} should be a valid port (0-65535), got "${value}"`;
      }
      return null;
    }

    case "boolean": {
      const valid = ["true", "false", "1", "0", "yes", "no"];
      if (!valid.includes(value.toLowerCase())) {
        return `${name} should be a boolean (true/false/1/0/yes/no), got "${value}"`;
      }
      return null;
    }

    case "url": {
      try {
        new URL(value);
        return null;
      } catch {
        return `${name} should be a valid URL, got "${value}"`;
      }
    }

    case "enum": {
      if (enumValues && !enumValues.includes(value)) {
        return `${name} should be one of [${enumValues.join(", ")}], got "${value}"`;
      }
      return null;
    }

    case "string":
      return null;
  }
}

export function findEnvFiles(cwd: string): string[] {
  const candidates = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    ".env.staging",
  ];

  return candidates
    .map((f) => path.join(cwd, f))
    .filter((f) => fs.existsSync(f));
}
