import fs from "node:fs";
import path from "node:path";
import type {
  EnvVarSchema,
  InferredType,
  ValidationError,
  ValidationResult,
} from "./types.js";

export function parseEnvFile(filePath: string): Map<string, string> {
  if (!fs.existsSync(filePath)) return new Map();
  const content = fs.readFileSync(filePath, "utf-8");
  return parseEnvContent(content);
}

export function parseEnvContent(content: string): Map<string, string> {
  const env = new Map<string, string>();
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    i++;

    if (!line || line.startsWith("#")) continue;

    // Strip optional `export ` prefix
    const stripped = line.startsWith("export ") ? line.slice(7) : line;
    const eqIndex = stripped.indexOf("=");
    if (eqIndex === -1) continue;

    const key = stripped.slice(0, eqIndex).trim();
    let rawValue = stripped.slice(eqIndex + 1).trim();

    // Double-quoted: supports multiline and escape sequences
    if (rawValue.startsWith('"')) {
      let value = rawValue.slice(1);
      while (!value.includes('"') && i < lines.length) {
        value += "\n" + lines[i];
        i++;
      }
      const closeIdx = value.indexOf('"');
      if (closeIdx !== -1) value = value.slice(0, closeIdx);
      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      env.set(key, value);
      continue;
    }

    // Single-quoted: literal, no escaping, supports multiline
    if (rawValue.startsWith("'")) {
      let value = rawValue.slice(1);
      while (!value.includes("'") && i < lines.length) {
        value += "\n" + lines[i];
        i++;
      }
      const closeIdx = value.indexOf("'");
      if (closeIdx !== -1) value = value.slice(0, closeIdx);
      env.set(key, value);
      continue;
    }

    // Unquoted: strip inline comments, trim
    const commentIdx = rawValue.indexOf(" #");
    if (commentIdx !== -1) rawValue = rawValue.slice(0, commentIdx);
    env.set(key, rawValue.trim());
  }

  // Variable interpolation: resolve ${VAR} references
  for (const [key, value] of env) {
    if (value.includes("${")) {
      env.set(key, value.replace(/\$\{([A-Z_][A-Z0-9_]*)}/g, (_, ref) => {
        return env.get(ref) ?? process.env[ref] ?? "";
      }));
    }
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

    case "integer": {
      const n = Number(value);
      if (isNaN(n) || !Number.isInteger(n)) {
        return `${name} should be an integer, got "${value}"`;
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

    case "email": {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return `${name} should be a valid email, got "${value}"`;
      }
      return null;
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
  const priority = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".env.production",
    ".env.production.local",
    ".env.staging",
    ".env.staging.local",
    ".env.test",
    ".env.test.local",
  ];

  const found = priority
    .map((f) => path.join(cwd, f))
    .filter((f) => fs.existsSync(f));

  // Also discover any .env.* files not in the priority list
  try {
    const entries = fs.readdirSync(cwd);
    for (const entry of entries) {
      if (entry.startsWith(".env") && entry !== ".env.example" && entry !== ".env.sample" && entry !== ".env.template") {
        const full = path.join(cwd, entry);
        if (!found.includes(full) && fs.statSync(full).isFile()) {
          found.push(full);
        }
      }
    }
  } catch {
    // directory not readable
  }

  return found;
}
