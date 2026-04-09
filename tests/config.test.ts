import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { generateSchema } from "../src/schema.js";
import type { EnvVarUsage } from "../src/types.js";

const TMP_DIR = path.resolve(__dirname, "fixtures/config-test");

describe("loadConfig", () => {
  beforeEach(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(TMP_DIR);
    expect(config.output).toBe("src/env.ts");
    expect(config.ignore).toEqual([]);
  });

  it("reads .envtypes.json", () => {
    fs.writeFileSync(
      path.join(TMP_DIR, ".envtypes.json"),
      JSON.stringify({ output: "lib/env.ts", ignore: ["DEBUG"] })
    );
    const config = loadConfig(TMP_DIR);
    expect(config.output).toBe("lib/env.ts");
    expect(config.ignore).toEqual(["DEBUG"]);
  });

  it("reads envtypes field from package.json", () => {
    fs.writeFileSync(
      path.join(TMP_DIR, "package.json"),
      JSON.stringify({ name: "test", envtypes: { output: "config/env.ts" } })
    );
    const config = loadConfig(TMP_DIR);
    expect(config.output).toBe("config/env.ts");
  });

  it("merges exclude arrays", () => {
    fs.writeFileSync(
      path.join(TMP_DIR, ".envtypes.json"),
      JSON.stringify({ exclude: ["**/custom/**"] })
    );
    const config = loadConfig(TMP_DIR);
    expect(config.exclude).toContain("**/node_modules/**");
    expect(config.exclude).toContain("**/custom/**");
  });
});

describe("schema overrides", () => {
  const usages: EnvVarUsage[] = [
    { name: "PORT", filePath: "a.ts", line: 1, column: 1, accessPattern: "dot", hasDefault: false },
    { name: "DEBUG", filePath: "a.ts", line: 2, column: 1, accessPattern: "dot", hasDefault: false },
    { name: "API_KEY", filePath: "a.ts", line: 3, column: 1, accessPattern: "dot", hasDefault: false },
  ];

  it("filters ignored variables", () => {
    const schemas = generateSchema(usages, { ignore: ["DEBUG"] });
    const names = schemas.map((s) => s.name);
    expect(names).not.toContain("DEBUG");
    expect(names).toContain("PORT");
    expect(names).toContain("API_KEY");
  });

  it("applies type overrides", () => {
    const schemas = generateSchema(usages, {
      overrides: {
        API_KEY: { type: "string", description: "Third-party API key" },
        PORT: { type: "number" },
      },
    });
    const apiKey = schemas.find((s) => s.name === "API_KEY");
    expect(apiKey?.description).toBe("Third-party API key");

    const port = schemas.find((s) => s.name === "PORT");
    expect(port?.type).toBe("number");
  });

  it("applies required override", () => {
    const schemas = generateSchema(usages, {
      overrides: {
        PORT: { required: false },
      },
    });
    const port = schemas.find((s) => s.name === "PORT");
    expect(port?.required).toBe(false);
  });

  it("applies enum overrides", () => {
    const schemas = generateSchema(usages, {
      overrides: {
        API_KEY: { type: "enum", enumValues: ["key1", "key2", "key3"] },
      },
    });
    const apiKey = schemas.find((s) => s.name === "API_KEY");
    expect(apiKey?.type).toBe("enum");
    expect(apiKey?.enumValues).toEqual(["key1", "key2", "key3"]);
  });
});
