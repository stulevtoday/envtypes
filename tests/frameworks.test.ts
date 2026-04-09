import { describe, it, expect } from "vitest";
import path from "node:path";
import { detectFrameworks, classifyVariable } from "../src/frameworks.js";

const NEXTJS_FIXTURE = path.resolve(__dirname, "fixtures/nextjs-project");
const PLAIN_FIXTURE = path.resolve(__dirname, "fixtures/sample-project");

describe("detectFrameworks", () => {
  it("detects Next.js from package.json", () => {
    const result = detectFrameworks(NEXTJS_FIXTURE);
    expect(result.detected).toHaveLength(1);
    expect(result.detected[0].name).toBe("next");
    expect(result.detected[0].clientPrefix).toBe("NEXT_PUBLIC_");
  });

  it("returns empty for plain projects", () => {
    const result = detectFrameworks(PLAIN_FIXTURE);
    expect(result.detected).toHaveLength(0);
  });

  it("reads package.json", () => {
    const result = detectFrameworks(NEXTJS_FIXTURE);
    expect(result.packageJson).not.toBeNull();
  });
});

describe("classifyVariable", () => {
  const nextFramework = {
    name: "next",
    clientPrefix: "NEXT_PUBLIC_",
    envAccess: "process.env" as const,
    configFiles: [],
  };

  it("classifies NEXT_PUBLIC_ vars as client", () => {
    expect(classifyVariable("NEXT_PUBLIC_API_URL", [nextFramework])).toBe("client");
    expect(classifyVariable("NEXT_PUBLIC_ANALYTICS_ID", [nextFramework])).toBe("client");
  });

  it("classifies secret-containing vars as server", () => {
    expect(classifyVariable("SECRET_KEY", [nextFramework])).toBe("server");
    expect(classifyVariable("DATABASE_URL", [nextFramework])).toBe("server");
    expect(classifyVariable("REDIS_HOST", [nextFramework])).toBe("server");
    expect(classifyVariable("AWS_ACCESS_KEY", [nextFramework])).toBe("server");
  });

  it("classifies ambiguous vars as unknown", () => {
    expect(classifyVariable("PORT", [nextFramework])).toBe("unknown");
    expect(classifyVariable("NODE_ENV", [nextFramework])).toBe("unknown");
  });
});
