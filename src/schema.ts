import type { EnvVarUsage, EnvVarSchema, InferredType } from "./types.js";
import type { EnvtypesConfig } from "./config.js";

const TYPE_HINTS: Record<string, InferredType> = {
  PORT: "port",
  HOST_PORT: "port",
  DB_PORT: "port",
  REDIS_PORT: "port",

  DEBUG: "boolean",
  VERBOSE: "boolean",
  ENABLE_CACHE: "boolean",
  USE_SSL: "boolean",

  DATABASE_URL: "url",
  REDIS_URL: "url",
  API_URL: "url",
  BASE_URL: "url",
  WEBHOOK_URL: "url",
  CALLBACK_URL: "url",

  NODE_ENV: "enum",
};

const SUFFIX_HINTS: [RegExp, InferredType][] = [
  [/_PORT$/i, "port"],
  [/_URL$/i, "url"],
  [/_URI$/i, "url"],
  [/_ENABLED?$/i, "boolean"],
  [/_DISABLED?$/i, "boolean"],
  [/_DEBUG$/i, "boolean"],
  [/_VERBOSE$/i, "boolean"],
  [/^IS_/i, "boolean"],
  [/^HAS_/i, "boolean"],
  [/^ENABLE_/i, "boolean"],
  [/^USE_/i, "boolean"],
  [/_COUNT$/i, "number"],
  [/_SIZE$/i, "number"],
  [/_LIMIT$/i, "number"],
  [/_TIMEOUT$/i, "number"],
  [/_TTL$/i, "number"],
  [/_MAX$/i, "number"],
  [/_MIN$/i, "number"],
  [/_RETRIES$/i, "number"],
  [/_INTERVAL$/i, "number"],
  [/_EMAIL$/i, "email"],
  [/^EMAIL$/i, "email"],
  [/^SMTP_FROM$/i, "email"],
  [/^MAIL_FROM$/i, "email"],
  [/^REPLY_TO$/i, "email"],
];

const KNOWN_ENUMS: Record<string, string[]> = {
  NODE_ENV: ["development", "production", "test", "staging"],
  LOG_LEVEL: ["debug", "info", "warn", "error", "fatal"],
};

export function inferType(name: string, defaultValue?: string): InferredType {
  if (TYPE_HINTS[name]) return TYPE_HINTS[name];

  for (const [pattern, type] of SUFFIX_HINTS) {
    if (pattern.test(name)) return type;
  }

  if (defaultValue !== undefined) {
    if (defaultValue === "true" || defaultValue === "false") return "boolean";
    if (/^\d+$/.test(defaultValue)) return "number";
    if (/^https?:\/\//.test(defaultValue)) return "url";
  }

  return "string";
}

export interface SchemaOptions {
  ignore?: string[];
  overrides?: EnvtypesConfig["overrides"];
}

export function generateSchema(
  usages: EnvVarUsage[],
  options: SchemaOptions = {}
): EnvVarSchema[] {
  const ignoreSet = new Set(options.ignore ?? []);
  const overrides = options.overrides ?? {};

  const grouped = new Map<string, EnvVarUsage[]>();

  for (const usage of usages) {
    if (ignoreSet.has(usage.name)) continue;
    const existing = grouped.get(usage.name) ?? [];
    existing.push(usage);
    grouped.set(usage.name, existing);
  }

  const schemas: EnvVarSchema[] = [];

  for (const [name, instances] of grouped) {
    const anyHasDefault = instances.some((i) => i.hasDefault);
    const firstDefault = instances.find((i) => i.defaultValue)?.defaultValue;
    const override = overrides[name];
    const type = override?.type ?? inferType(name, firstDefault);

    const schema: EnvVarSchema = {
      name,
      type,
      required: override?.required ?? !anyHasDefault,
      defaultValue: firstDefault,
      description: override?.description,
    };

    if (type === "enum") {
      schema.enumValues = override?.enumValues ?? KNOWN_ENUMS[name];
    }

    schemas.push(schema);
  }

  return schemas.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function schemaToTypenvFile(schemas: EnvVarSchema[]): string {
  const lines: string[] = [
    `import { defineEnv, t } from "envtypes";`,
    "",
    "export default defineEnv({",
  ];

  for (const schema of schemas) {
    const parts: string[] = [];

    switch (schema.type) {
      case "string":
        parts.push("t.string()");
        break;
      case "number":
        parts.push("t.number()");
        break;
      case "integer":
        parts.push("t.integer()");
        break;
      case "boolean":
        parts.push("t.boolean()");
        break;
      case "url":
        parts.push("t.url()");
        break;
      case "port":
        parts.push("t.port()");
        break;
      case "email":
        parts.push("t.email()");
        break;
      case "enum":
        if (schema.enumValues) {
          const vals = schema.enumValues.map((v) => `"${v}"`).join(", ");
          parts.push(`t.enum([${vals}])`);
        } else {
          parts.push("t.string()");
        }
        break;
    }

    if (schema.defaultValue !== undefined) {
      parts.push(`.default(${JSON.stringify(schema.defaultValue)})`);
    }

    if (!schema.required) {
      parts.push(".optional()");
    }

    const comment = schema.description ? ` // ${schema.description}` : "";
    lines.push(`  ${schema.name}: ${parts.join("")},${comment}`);
  }

  lines.push("});", "");
  return lines.join("\n");
}
