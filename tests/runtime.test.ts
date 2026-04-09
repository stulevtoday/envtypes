import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defineEnv, t } from "../src/runtime.js";

describe("runtime", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("t.string", () => {
    it("parses string value", () => {
      process.env.TEST = "hello";
      const env = defineEnv({ TEST: t.string() });
      expect(env.TEST).toBe("hello");
    });

    it("throws on missing required string", () => {
      delete process.env.TEST;
      expect(() => defineEnv({ TEST: t.string() })).toThrow(
        "Environment validation failed"
      );
    });

    it("uses default when not set", () => {
      delete process.env.TEST;
      const env = defineEnv({ TEST: t.string().default("fallback") });
      expect(env.TEST).toBe("fallback");
    });

    it("returns undefined for optional missing string", () => {
      delete process.env.TEST;
      const env = defineEnv({ TEST: t.string().optional() });
      expect(env.TEST).toBeUndefined();
    });
  });

  describe("t.number", () => {
    it("parses number value", () => {
      process.env.PORT = "3000";
      const env = defineEnv({ PORT: t.number() });
      expect(env.PORT).toBe(3000);
    });

    it("throws on non-numeric value", () => {
      process.env.PORT = "abc";
      expect(() => defineEnv({ PORT: t.number() })).toThrow(
        "Environment validation failed"
      );
    });
  });

  describe("t.boolean", () => {
    it("parses true variants", () => {
      for (const val of ["true", "1", "yes", "TRUE", "Yes"]) {
        process.env.DEBUG = val;
        const env = defineEnv({ DEBUG: t.boolean() });
        expect(env.DEBUG).toBe(true);
      }
    });

    it("parses false variants", () => {
      for (const val of ["false", "0", "no", "FALSE", "No"]) {
        process.env.DEBUG = val;
        const env = defineEnv({ DEBUG: t.boolean() });
        expect(env.DEBUG).toBe(false);
      }
    });

    it("throws on invalid boolean", () => {
      process.env.DEBUG = "maybe";
      expect(() => defineEnv({ DEBUG: t.boolean() })).toThrow();
    });
  });

  describe("t.port", () => {
    it("accepts valid ports", () => {
      process.env.PORT = "8080";
      const env = defineEnv({ PORT: t.port() });
      expect(env.PORT).toBe(8080);
    });

    it("rejects invalid ports", () => {
      process.env.PORT = "99999";
      expect(() => defineEnv({ PORT: t.port() })).toThrow();
    });
  });

  describe("t.url", () => {
    it("accepts valid URLs", () => {
      process.env.API = "https://api.example.com";
      const env = defineEnv({ API: t.url() });
      expect(env.API).toBe("https://api.example.com");
    });

    it("rejects invalid URLs", () => {
      process.env.API = "not-a-url";
      expect(() => defineEnv({ API: t.url() })).toThrow();
    });
  });

  describe("t.enum", () => {
    it("accepts valid enum values", () => {
      process.env.NODE_ENV = "production";
      const env = defineEnv({
        NODE_ENV: t.enum(["development", "production", "test"]),
      });
      expect(env.NODE_ENV).toBe("production");
    });

    it("rejects invalid enum values", () => {
      process.env.NODE_ENV = "staging";
      expect(() =>
        defineEnv({
          NODE_ENV: t.enum(["development", "production", "test"]),
        })
      ).toThrow();
    });
  });

  describe("defineEnv", () => {
    it("validates full schema", () => {
      process.env.PORT = "3000";
      process.env.DATABASE_URL = "postgres://localhost/db";
      process.env.NODE_ENV = "development";
      process.env.DEBUG = "true";

      const env = defineEnv({
        PORT: t.port().default("8080"),
        DATABASE_URL: t.url(),
        NODE_ENV: t.enum(["development", "production", "test"]),
        DEBUG: t.boolean().optional(),
        MISSING: t.string().optional(),
      });

      expect(env.PORT).toBe(3000);
      expect(env.DATABASE_URL).toBe("postgres://localhost/db");
      expect(env.NODE_ENV).toBe("development");
      expect(env.DEBUG).toBe(true);
      expect(env.MISSING).toBeUndefined();
    });

    it("reports all errors at once", () => {
      delete process.env.A;
      delete process.env.B;

      try {
        defineEnv({ A: t.string(), B: t.number() });
        expect.unreachable("should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("A:");
        expect(err.message).toContain("B:");
      }
    });
  });

  describe("t.integer", () => {
    it("accepts valid integers", () => {
      process.env.COUNT = "42";
      const env = defineEnv({ COUNT: t.integer() });
      expect(env.COUNT).toBe(42);
    });

    it("rejects floats", () => {
      process.env.COUNT = "3.14";
      expect(() => defineEnv({ COUNT: t.integer() })).toThrow();
    });
  });

  describe("t.email", () => {
    it("accepts valid emails", () => {
      process.env.MAIL = "user@example.com";
      const env = defineEnv({ MAIL: t.email() });
      expect(env.MAIL).toBe("user@example.com");
    });

    it("rejects invalid emails", () => {
      process.env.MAIL = "not-an-email";
      expect(() => defineEnv({ MAIL: t.email() })).toThrow();
    });
  });

  describe("t.json", () => {
    it("parses valid JSON", () => {
      process.env.CONFIG = '{"host":"localhost","port":5432}';
      const env = defineEnv({ CONFIG: t.json() });
      expect(env.CONFIG).toEqual({ host: "localhost", port: 5432 });
    });

    it("rejects invalid JSON", () => {
      process.env.CONFIG = "not json";
      expect(() => defineEnv({ CONFIG: t.json() })).toThrow();
    });
  });

  describe("t.regex", () => {
    it("accepts matching values", () => {
      process.env.TAG = "v1.2.3";
      const env = defineEnv({ TAG: t.regex(/^v\d+\.\d+\.\d+$/, "semver") });
      expect(env.TAG).toBe("v1.2.3");
    });

    it("rejects non-matching values", () => {
      process.env.TAG = "latest";
      expect(() => defineEnv({ TAG: t.regex(/^v\d+\.\d+\.\d+$/) })).toThrow();
    });
  });

  describe("description", () => {
    it("does not affect validation", () => {
      process.env.TEST = "hello";
      const env = defineEnv({
        TEST: t.string().description("A test variable"),
      });
      expect(env.TEST).toBe("hello");
    });
  });
});
