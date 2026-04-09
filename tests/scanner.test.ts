import { describe, it, expect } from "vitest";
import path from "node:path";
import { scan } from "../src/scanner.js";

const FIXTURE_DIR = path.resolve(__dirname, "fixtures/sample-project");

describe("scanner", () => {
  it("discovers all env var usages in fixture project", () => {
    const result = scan({ cwd: FIXTURE_DIR });

    const names = [...new Set(result.variables.map((v) => v.name))].sort();

    expect(names).toEqual([
      "API_KEY",
      "CACHE_TTL",
      "DATABASE_URL",
      "ENABLE_LOGGING",
      "HOST",
      "MAX_RETRIES",
      "NODE_ENV",
      "PORT",
      "REDIS_URL",
      "SECRET_TOKEN",
      "VERBOSE",
    ]);
  });

  it("detects dot access pattern", () => {
    const result = scan({ cwd: FIXTURE_DIR });
    const portUsage = result.variables.find(
      (v) => v.name === "DATABASE_URL" && v.accessPattern === "dot"
    );
    expect(portUsage).toBeDefined();
  });

  it("detects bracket access pattern", () => {
    const result = scan({ cwd: FIXTURE_DIR });
    const apiKey = result.variables.find(
      (v) => v.name === "API_KEY" && v.accessPattern === "bracket"
    );
    expect(apiKey).toBeDefined();
  });

  it("detects destructuring pattern", () => {
    const result = scan({ cwd: FIXTURE_DIR });
    const redis = result.variables.find(
      (v) => v.name === "REDIS_URL" && v.accessPattern === "destructure"
    );
    expect(redis).toBeDefined();
  });

  it("detects default values", () => {
    const result = scan({ cwd: FIXTURE_DIR });
    const cacheTtl = result.variables.find((v) => v.name === "CACHE_TTL");
    expect(cacheTtl?.hasDefault).toBe(true);
    expect(cacheTtl?.defaultValue).toBe("3600");
  });

  it("detects defaults from || and ?? operators", () => {
    const result = scan({ cwd: FIXTURE_DIR });

    const port = result.variables.find(
      (v) => v.name === "PORT" && v.hasDefault
    );
    expect(port).toBeDefined();
    expect(port?.defaultValue).toBe("3000");

    const host = result.variables.find(
      (v) => v.name === "HOST" && v.hasDefault
    );
    expect(host).toBeDefined();
    expect(host?.defaultValue).toBe("0.0.0.0");
  });

  it("detects ternary defaults", () => {
    const result = scan({ cwd: FIXTURE_DIR });
    const verbose = result.variables.find(
      (v) => v.name === "VERBOSE" && v.hasDefault
    );
    expect(verbose).toBeDefined();
    expect(verbose?.defaultValue).toBe("false");
  });

  it("returns file list", () => {
    const result = scan({ cwd: FIXTURE_DIR });
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files[0]).toContain("server.ts");
  });

  it("reports scan duration", () => {
    const result = scan({ cwd: FIXTURE_DIR });
    expect(result.duration).toBeGreaterThan(0);
  });
});
