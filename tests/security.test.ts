import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyzeSecurityIssues } from "../src/security.js";
import type { EnvVarSchema } from "../src/types.js";
import type { FrameworkInfo } from "../src/frameworks.js";

const nextFramework: FrameworkInfo = {
  name: "next",
  clientPrefix: "NEXT_PUBLIC_",
  envAccess: "process.env",
  configFiles: [],
};

describe("security analysis", () => {
  describe("client-exposed secrets", () => {
    it("flags client-prefixed vars containing SECRET", () => {
      const schemas: EnvVarSchema[] = [
        { name: "NEXT_PUBLIC_API_SECRET", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [nextFramework]);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("critical");
      expect(issues[0].rule).toBe("client-exposed-secret");
    });

    it("flags client-prefixed vars containing PASSWORD", () => {
      const schemas: EnvVarSchema[] = [
        { name: "NEXT_PUBLIC_DB_PASSWORD", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [nextFramework]);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("critical");
    });

    it("flags client-prefixed vars containing TOKEN", () => {
      const schemas: EnvVarSchema[] = [
        { name: "NEXT_PUBLIC_AUTH_TOKEN", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [nextFramework]);
      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe("client-exposed-secret");
    });

    it("does not flag safe client vars", () => {
      const schemas: EnvVarSchema[] = [
        { name: "NEXT_PUBLIC_API_URL", type: "url", required: true },
        { name: "NEXT_PUBLIC_APP_NAME", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [nextFramework]);
      expect(issues).toHaveLength(0);
    });

    it("flags client-exposed known credentials", () => {
      const schemas: EnvVarSchema[] = [
        { name: "NEXT_PUBLIC_STRIPE_SECRET_KEY", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [nextFramework]);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].severity).toBe("critical");
    });

    it("flags client-exposed database URLs", () => {
      const schemas: EnvVarSchema[] = [
        { name: "NEXT_PUBLIC_DATABASE_URL", type: "url", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [nextFramework]);
      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe("client-exposed-connection-string");
    });

    it("skips checks when no frameworks detected", () => {
      const schemas: EnvVarSchema[] = [
        { name: "API_SECRET", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, []);
      expect(issues).toHaveLength(0);
    });
  });

  describe("weak defaults", () => {
    it("flags weak default on secret vars", () => {
      const schemas: EnvVarSchema[] = [
        { name: "JWT_SECRET", type: "string", required: false, defaultValue: "secret" },
      ];
      const issues = analyzeSecurityIssues(schemas, []);
      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe("weak-default-secret");
      expect(issues[0].severity).toBe("warning");
    });

    it("flags short defaults on secret vars", () => {
      const schemas: EnvVarSchema[] = [
        { name: "SESSION_SECRET", type: "string", required: false, defaultValue: "abc" },
      ];
      const issues = analyzeSecurityIssues(schemas, []);
      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe("weak-default-secret");
    });

    it("does not flag defaults on non-secret vars", () => {
      const schemas: EnvVarSchema[] = [
        { name: "PORT", type: "port", required: false, defaultValue: "3000" },
        { name: "HOST", type: "string", required: false, defaultValue: "localhost" },
      ];
      const issues = analyzeSecurityIssues(schemas, []);
      expect(issues).toHaveLength(0);
    });
  });

  describe("value patterns", () => {
    it("reports localhost URLs as info", () => {
      const schemas: EnvVarSchema[] = [
        { name: "DATABASE_URL", type: "url", required: true },
      ];
      const env = new Map([["DATABASE_URL", "postgres://localhost:5432/db"]]);
      const issues = analyzeSecurityIssues(schemas, [], env);
      expect(issues.some((i) => i.rule === "localhost-url")).toBe(true);
      expect(issues.find((i) => i.rule === "localhost-url")?.severity).toBe("info");
    });
  });

  describe("gitignore check", () => {
    const tmpDir = path.resolve(__dirname, "fixtures/gitignore-test");

    beforeEach(() => {
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("warns when no .gitignore exists", () => {
      const schemas: EnvVarSchema[] = [
        { name: "API_KEY", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [], undefined, tmpDir);
      expect(issues.some((i) => i.rule === "no-gitignore")).toBe(true);
    });

    it("warns when .gitignore does not cover .env", () => {
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\ndist/\n");
      const schemas: EnvVarSchema[] = [
        { name: "API_KEY", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [], undefined, tmpDir);
      expect(issues.some((i) => i.rule === "env-not-gitignored")).toBe(true);
    });

    it("does not warn when .gitignore covers .env", () => {
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n.env\n.env.local\n");
      const schemas: EnvVarSchema[] = [
        { name: "API_KEY", type: "string", required: true },
      ];
      const issues = analyzeSecurityIssues(schemas, [], undefined, tmpDir);
      expect(issues.some((i) => i.rule === "no-gitignore")).toBe(false);
      expect(issues.some((i) => i.rule === "env-not-gitignored")).toBe(false);
    });
  });
});
