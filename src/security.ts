import fs from "node:fs";
import path from "node:path";
import type { EnvVarSchema, EnvScope } from "./types.js";
import type { FrameworkInfo } from "./frameworks.js";
import { classifyVariable } from "./frameworks.js";

export type Severity = "critical" | "warning" | "info";

export interface SecurityIssue {
  variable: string;
  severity: Severity;
  rule: string;
  message: string;
  suggestion?: string;
}

const SECRET_PATTERNS = [
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "TOKEN",
  "PRIVATE_KEY",
  "SIGNING_KEY",
  "ENCRYPTION_KEY",
  "AUTH_KEY",
  "API_SECRET",
  "CLIENT_SECRET",
  "JWT_SECRET",
  "SESSION_SECRET",
  "COOKIE_SECRET",
  "HMAC",
];

const CREDENTIAL_PATTERNS = [
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SENDGRID_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "FIREBASE_PRIVATE_KEY",
  "GCP_PRIVATE_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SENTRY_AUTH_TOKEN",
  "VERCEL_TOKEN",
  "NETLIFY_AUTH_TOKEN",
  "NPM_TOKEN",
  "DOCKER_PASSWORD",
];

const DB_CONNECTION_PATTERNS = [
  "DATABASE_URL",
  "DB_URL",
  "DB_CONNECTION",
  "MONGO_URI",
  "MONGODB_URI",
  "REDIS_URL",
  "REDIS_URI",
  "AMQP_URL",
  "ELASTICSEARCH_URL",
];

export function analyzeSecurityIssues(
  schemas: EnvVarSchema[],
  frameworks: FrameworkInfo[],
  envValues?: Map<string, string>,
  cwd?: string,
): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  if (cwd) {
    issues.push(...checkGitignoreCoversEnv(cwd));
  }

  for (const schema of schemas) {
    issues.push(
      ...checkClientExposedSecrets(schema, frameworks),
      ...checkWeakDefaults(schema),
    );

    if (envValues) {
      issues.push(...checkValuePatterns(schema, envValues));
    }
  }

  return issues;
}

function checkClientExposedSecrets(
  schema: EnvVarSchema,
  frameworks: FrameworkInfo[]
): SecurityIssue[] {
  if (frameworks.length === 0) return [];

  const scope = classifyVariable(schema.name, frameworks);
  if (scope !== "client") return [];

  const nameWithoutPrefix = stripClientPrefix(schema.name, frameworks);

  const looksLikeSecret = SECRET_PATTERNS.some((p) =>
    nameWithoutPrefix.includes(p)
  );

  if (looksLikeSecret) {
    return [{
      variable: schema.name,
      severity: "critical",
      rule: "client-exposed-secret",
      message: `${schema.name} is client-exposed but contains "${findMatchingPattern(nameWithoutPrefix, SECRET_PATTERNS)}" — this will be visible in the browser`,
      suggestion: `Move the secret to a server-only variable without the client prefix, and proxy through an API route`,
    }];
  }

  if (CREDENTIAL_PATTERNS.some((p) => nameWithoutPrefix === p || schema.name === p)) {
    return [{
      variable: schema.name,
      severity: "critical",
      rule: "client-exposed-credential",
      message: `${schema.name} is client-exposed but matches a known credential pattern — this will leak to the browser`,
      suggestion: `Never expose credentials to the client. Use a server-side API route instead`,
    }];
  }

  if (DB_CONNECTION_PATTERNS.some((p) => nameWithoutPrefix === p)) {
    return [{
      variable: schema.name,
      severity: "critical",
      rule: "client-exposed-connection-string",
      message: `${schema.name} is client-exposed but looks like a database connection string — this will leak database credentials to the browser`,
      suggestion: `Database connections must stay server-only. Remove the client prefix`,
    }];
  }

  return [];
}

function checkWeakDefaults(schema: EnvVarSchema): SecurityIssue[] {
  if (!schema.defaultValue) return [];

  const name = schema.name;
  const val = schema.defaultValue;

  const isSecretVar =
    SECRET_PATTERNS.some((p) => name.includes(p)) ||
    CREDENTIAL_PATTERNS.includes(name);

  if (!isSecretVar) return [];

  const weakDefaults = [
    "secret", "password", "changeme", "default", "test",
    "123456", "admin", "token", "key", "xxx", "placeholder",
    "your_secret", "your_token", "your_password", "your_key",
    "todo", "fixme", "replace_me",
  ];

  if (weakDefaults.some((w) => val.toLowerCase().includes(w)) || val.length < 8) {
    return [{
      variable: name,
      severity: "warning",
      rule: "weak-default-secret",
      message: `${name} has a weak or placeholder default value`,
      suggestion: `Remove the default and require explicit configuration. Use a secret manager for production values`,
    }];
  }

  return [];
}

function checkGitignoreCoversEnv(cwd: string): SecurityIssue[] {
  const gitignorePath = path.join(cwd, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return [{
      variable: ".gitignore",
      severity: "warning",
      rule: "no-gitignore",
      message: "No .gitignore found — .env files may be committed to version control",
      suggestion: "Create a .gitignore and add .env, .env.local, .env.*.local",
    }];
  }

  const content = fs.readFileSync(gitignorePath, "utf-8");
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  const envPatterns = [".env", ".env.*", ".env.local", ".env*.local", ".env.*.local"];
  const covered = envPatterns.some((p) => lines.includes(p)) || lines.includes(".env*");

  if (!covered) {
    return [{
      variable: ".gitignore",
      severity: "warning",
      rule: "env-not-gitignored",
      message: ".env files are not listed in .gitignore — secrets may be committed",
      suggestion: "Add .env, .env.local, and .env.*.local to your .gitignore",
    }];
  }

  return [];
}

function checkValuePatterns(
  schema: EnvVarSchema,
  envValues: Map<string, string>
): SecurityIssue[] {
  const value = envValues.get(schema.name);
  if (!value) return [];

  const issues: SecurityIssue[] = [];

  // Detect hardcoded localhost/0.0.0.0 in production-looking configs
  if (schema.type === "url" && value.includes("localhost")) {
    issues.push({
      variable: schema.name,
      severity: "info",
      rule: "localhost-url",
      message: `${schema.name} points to localhost — make sure this is intentional for your environment`,
    });
  }

  // Detect empty or whitespace-only values for required vars
  if (schema.required && value.trim() === "") {
    issues.push({
      variable: schema.name,
      severity: "warning",
      rule: "empty-required",
      message: `${schema.name} is required but set to an empty value`,
    });
  }

  return issues;
}

function stripClientPrefix(name: string, frameworks: FrameworkInfo[]): string {
  for (const fw of frameworks) {
    if (fw.clientPrefix && name.startsWith(fw.clientPrefix)) {
      return name.slice(fw.clientPrefix.length);
    }
  }
  return name;
}

function findMatchingPattern(name: string, patterns: string[]): string {
  return patterns.find((p) => name.includes(p)) ?? "";
}
