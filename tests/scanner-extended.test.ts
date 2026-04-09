import { describe, it, expect } from "vitest";
import path from "node:path";
import { scan } from "../src/scanner.js";

const MULTI_RUNTIME = path.resolve(__dirname, "fixtures/multi-runtime");

describe("scanner: multi-runtime support", () => {
  it("discovers Deno.env.get() calls", () => {
    const result = scan({ cwd: MULTI_RUNTIME });
    const denoVars = result.variables.filter((v) =>
      v.filePath.includes("deno-server")
    );
    const names = denoVars.map((v) => v.name);
    expect(names).toContain("PORT");
    expect(names).toContain("DATABASE_URL");
    expect(names).toContain("DEBUG");
  });

  it("discovers Bun.env dot access", () => {
    const result = scan({ cwd: MULTI_RUNTIME });
    const bunDot = result.variables.filter(
      (v) => v.filePath.includes("bun-server") && v.accessPattern === "dot"
    );
    const names = bunDot.map((v) => v.name);
    expect(names).toContain("PORT");
    expect(names).toContain("API_KEY");
  });

  it("discovers Bun.env destructuring", () => {
    const result = scan({ cwd: MULTI_RUNTIME });
    const bunDestructured = result.variables.filter(
      (v) => v.filePath.includes("bun-server") && v.accessPattern === "destructure"
    );
    const names = bunDestructured.map((v) => v.name);
    expect(names).toContain("REDIS_URL");
    expect(names).toContain("CACHE_TTL");
  });

  it("detects defaults across runtimes", () => {
    const result = scan({ cwd: MULTI_RUNTIME });

    const denoPort = result.variables.find(
      (v) => v.name === "PORT" && v.filePath.includes("deno-server")
    );
    expect(denoPort?.hasDefault).toBe(true);
    expect(denoPort?.defaultValue).toBe("8000");

    const bunPort = result.variables.find(
      (v) => v.name === "PORT" && v.filePath.includes("bun-server")
    );
    expect(bunPort?.hasDefault).toBe(true);
    expect(bunPort?.defaultValue).toBe("3000");

    const bunCacheTtl = result.variables.find(
      (v) => v.name === "CACHE_TTL" && v.filePath.includes("bun-server")
    );
    expect(bunCacheTtl?.hasDefault).toBe(true);
    expect(bunCacheTtl?.defaultValue).toBe("600");
  });
});
