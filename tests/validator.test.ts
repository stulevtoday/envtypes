import { describe, it, expect } from "vitest";
import path from "node:path";
import { validate, parseEnvFile } from "../src/validator.js";
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
});
