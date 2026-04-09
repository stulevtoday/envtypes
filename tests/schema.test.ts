import { describe, it, expect } from "vitest";
import { inferType, generateSchema } from "../src/schema.js";
import type { EnvVarUsage } from "../src/types.js";

describe("inferType", () => {
  it("infers port type from name", () => {
    expect(inferType("PORT")).toBe("port");
    expect(inferType("DB_PORT")).toBe("port");
  });

  it("infers boolean from name patterns", () => {
    expect(inferType("DEBUG")).toBe("boolean");
    expect(inferType("ENABLE_CACHE")).toBe("boolean");
    expect(inferType("IS_PRODUCTION")).toBe("boolean");
    expect(inferType("USE_SSL")).toBe("boolean");
  });

  it("infers url from name patterns", () => {
    expect(inferType("DATABASE_URL")).toBe("url");
    expect(inferType("API_URL")).toBe("url");
    expect(inferType("WEBHOOK_URI")).toBe("url");
  });

  it("infers number from name suffixes", () => {
    expect(inferType("MAX_RETRIES")).toBe("number");
    expect(inferType("CACHE_TTL")).toBe("number");
    expect(inferType("REQUEST_TIMEOUT")).toBe("number");
    expect(inferType("POOL_SIZE")).toBe("number");
  });

  it("infers enum for NODE_ENV", () => {
    expect(inferType("NODE_ENV")).toBe("enum");
  });

  it("infers from default value when name gives no hint", () => {
    expect(inferType("SOME_FLAG", "true")).toBe("boolean");
    expect(inferType("SOME_COUNT", "42")).toBe("number");
    expect(inferType("SOME_ENDPOINT", "https://api.example.com")).toBe("url");
  });

  it("falls back to string", () => {
    expect(inferType("API_KEY")).toBe("string");
    expect(inferType("SECRET_TOKEN")).toBe("string");
  });
});

describe("generateSchema", () => {
  const usages: EnvVarUsage[] = [
    { name: "PORT", filePath: "a.ts", line: 1, column: 1, accessPattern: "dot", hasDefault: true, defaultValue: "3000" },
    { name: "DATABASE_URL", filePath: "a.ts", line: 2, column: 1, accessPattern: "dot", hasDefault: false },
    { name: "DEBUG", filePath: "b.ts", line: 1, column: 1, accessPattern: "dot", hasDefault: true, defaultValue: "false" },
    { name: "DATABASE_URL", filePath: "b.ts", line: 5, column: 1, accessPattern: "dot", hasDefault: false },
  ];

  it("deduplicates variables by name", () => {
    const schemas = generateSchema(usages);
    const names = schemas.map((s) => s.name);
    expect(names.filter((n) => n === "DATABASE_URL")).toHaveLength(1);
  });

  it("marks variables without defaults as required", () => {
    const schemas = generateSchema(usages);
    const dbUrl = schemas.find((s) => s.name === "DATABASE_URL");
    expect(dbUrl?.required).toBe(true);
  });

  it("marks variables with defaults as optional", () => {
    const schemas = generateSchema(usages);
    const port = schemas.find((s) => s.name === "PORT");
    expect(port?.required).toBe(false);
  });

  it("sorts required before optional", () => {
    const schemas = generateSchema(usages);
    const requiredIdx = schemas.findIndex((s) => s.name === "DATABASE_URL");
    const optionalIdx = schemas.findIndex((s) => s.name === "PORT");
    expect(requiredIdx).toBeLessThan(optionalIdx);
  });

  it("infers correct types", () => {
    const schemas = generateSchema(usages);
    expect(schemas.find((s) => s.name === "PORT")?.type).toBe("port");
    expect(schemas.find((s) => s.name === "DATABASE_URL")?.type).toBe("url");
    expect(schemas.find((s) => s.name === "DEBUG")?.type).toBe("boolean");
  });
});
