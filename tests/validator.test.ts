import { describe, it, expect } from "vitest";
import path from "node:path";
import { validate, parseEnvFile, parseEnvContent } from "../src/validator.js";
import type { EnvVarSchema } from "../src/types.js";

const FIXTURE_ENV = path.resolve(
  __dirname,
  "fixtures/sample-project/.env"
);

describe("parseEnvFile", () => {
  it("parses .env file into key-value map", () => {
    const env = parseEnvFile(FIXTURE_ENV);
    expect(env.get("PORT")).toBe("8080");
    expect(env.get("DATABASE_URL")).toBe("postgres://localhost:5432/mydb");
    expect(env.get("NODE_ENV")).toBe("development");
  });

  it("returns empty map for nonexistent file", () => {
    const env = parseEnvFile("/nonexistent/.env");
    expect(env.size).toBe(0);
  });
});

describe("validate", () => {
  const schemas: EnvVarSchema[] = [
    { name: "PORT", type: "port", required: true },
    { name: "DATABASE_URL", type: "url", required: true },
    { name: "NODE_ENV", type: "enum", required: true, enumValues: ["development", "production", "test"] },
    { name: "DEBUG", type: "boolean", required: false },
    { name: "MAX_RETRIES", type: "number", required: false, defaultValue: "3" },
  ];

  it("passes valid env", () => {
    const env = new Map([
      ["PORT", "3000"],
      ["DATABASE_URL", "postgres://localhost:5432/db"],
      ["NODE_ENV", "development"],
    ]);
    const result = validate(schemas, env);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.typeErrors).toHaveLength(0);
  });

  it("catches missing required variables", () => {
    const env = new Map([
      ["PORT", "3000"],
    ]);
    const result = validate(schemas, env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("DATABASE_URL");
    expect(result.missing).toContain("NODE_ENV");
  });

  it("catches invalid port", () => {
    const env = new Map([
      ["PORT", "99999"],
      ["DATABASE_URL", "postgres://localhost/db"],
      ["NODE_ENV", "development"],
    ]);
    const result = validate(schemas, env);
    expect(result.valid).toBe(false);
    expect(result.typeErrors).toContain("PORT");
  });

  it("catches invalid url", () => {
    const env = new Map([
      ["PORT", "3000"],
      ["DATABASE_URL", "not-a-url"],
      ["NODE_ENV", "development"],
    ]);
    const result = validate(schemas, env);
    expect(result.valid).toBe(false);
    expect(result.typeErrors).toContain("DATABASE_URL");
  });

  it("catches invalid enum value", () => {
    const env = new Map([
      ["PORT", "3000"],
      ["DATABASE_URL", "postgres://localhost/db"],
      ["NODE_ENV", "invalid"],
    ]);
    const result = validate(schemas, env);
    expect(result.valid).toBe(false);
    expect(result.typeErrors).toContain("NODE_ENV");
  });

  it("reports extra variables not in schema", () => {
    const env = new Map([
      ["PORT", "3000"],
      ["DATABASE_URL", "postgres://localhost/db"],
      ["NODE_ENV", "development"],
      ["UNKNOWN_VAR", "something"],
    ]);
    const result = validate(schemas, env);
    expect(result.extra).toContain("UNKNOWN_VAR");
  });

  it("does not require optional vars", () => {
    const env = new Map([
      ["PORT", "3000"],
      ["DATABASE_URL", "postgres://localhost/db"],
      ["NODE_ENV", "development"],
    ]);
    const result = validate(schemas, env);
    expect(result.valid).toBe(true);
    expect(result.missing).not.toContain("DEBUG");
    expect(result.missing).not.toContain("MAX_RETRIES");
  });

  it("validates email type", () => {
    const schemas: EnvVarSchema[] = [
      { name: "ADMIN_EMAIL", type: "email", required: true },
    ];
    const good = new Map([["ADMIN_EMAIL", "user@example.com"]]);
    expect(validate(schemas, good).valid).toBe(true);

    const bad = new Map([["ADMIN_EMAIL", "not-an-email"]]);
    expect(validate(schemas, bad).valid).toBe(false);
  });

  it("validates integer type", () => {
    const schemas: EnvVarSchema[] = [
      { name: "WORKERS", type: "integer", required: true },
    ];
    const good = new Map([["WORKERS", "4"]]);
    expect(validate(schemas, good).valid).toBe(true);

    const bad = new Map([["WORKERS", "3.5"]]);
    expect(validate(schemas, bad).valid).toBe(false);
  });
});

describe("parseEnvContent", () => {
  it("handles export prefix", () => {
    const env = parseEnvContent('export PORT=3000\nexport HOST=localhost');
    expect(env.get("PORT")).toBe("3000");
    expect(env.get("HOST")).toBe("localhost");
  });

  it("handles multiline double-quoted values", () => {
    const env = parseEnvContent('RSA_KEY="line1\nline2\nline3"');
    expect(env.get("RSA_KEY")).toBe("line1\nline2\nline3");
  });

  it("handles actual multiline double-quoted values", () => {
    const env = parseEnvContent('CERT="-----BEGIN CERT-----\nABC\n-----END CERT-----"');
    expect(env.get("CERT")).toBe("-----BEGIN CERT-----\nABC\n-----END CERT-----");
  });

  it("handles single-quoted values literally", () => {
    const env = parseEnvContent("GREETING='hello\\nworld'");
    expect(env.get("GREETING")).toBe("hello\\nworld");
  });

  it("handles escape sequences in double quotes", () => {
    const env = parseEnvContent('MSG="hello\\tworld\\n"');
    expect(env.get("MSG")).toBe("hello\tworld\n");
  });

  it("strips inline comments from unquoted values", () => {
    const env = parseEnvContent("PORT=3000 # web server port");
    expect(env.get("PORT")).toBe("3000");
  });

  it("resolves variable interpolation", () => {
    const env = parseEnvContent('HOST=localhost\nPORT=5432\nDB=mydb\nDATABASE_URL=postgres://${HOST}:${PORT}/${DB}');
    expect(env.get("DATABASE_URL")).toBe("postgres://localhost:5432/mydb");
  });

  it("skips comments and empty lines", () => {
    const env = parseEnvContent("# this is a comment\n\nPORT=3000\n\n# another comment");
    expect(env.size).toBe(1);
    expect(env.get("PORT")).toBe("3000");
  });
});
