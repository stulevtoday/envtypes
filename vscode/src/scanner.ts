import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

export interface ScannedVar {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  files: Array<{ path: string; line: number }>;
  scope?: "client" | "server" | "unknown";
}

export interface SecurityIssue {
  variable: string;
  severity: "critical" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface ScanState {
  variables: Map<string, ScannedVar>;
  securityIssues: SecurityIssue[];
  frameworks: string[];
  lastScan: number;
}

export class EnvScanner {
  private state: ScanState = {
    variables: new Map(),
    securityIssues: [],
    frameworks: [],
    lastScan: 0,
  };

  get variables() { return this.state.variables; }
  get securityIssues() { return this.state.securityIssues; }
  get frameworks() { return this.state.frameworks; }

  scan(cwd: string): boolean {
    try {
      const result = execSync("npx envtypes doctor --json 2>/dev/null", {
        cwd,
        timeout: 30_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const data = JSON.parse(result.trim());
      this.state.frameworks = data.frameworks ?? [];
      this.state.securityIssues = (data.security ?? []).map((s: any) => ({
        variable: s.variable,
        severity: s.severity,
        message: s.message,
        suggestion: s.suggestion,
      }));

      this.state.lastScan = Date.now();
      return true;
    } catch {
      return this.scanFallback(cwd);
    }
  }

  private scanFallback(cwd: string): boolean {
    try {
      const result = execSync("npx envtypes scan --json 2>/dev/null", {
        cwd,
        timeout: 30_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const data = JSON.parse(result.trim());
      const vars = new Map<string, ScannedVar>();

      for (const v of data.variables ?? []) {
        const existing = vars.get(v.name);
        if (existing) {
          existing.files.push({ path: v.filePath, line: v.line });
          if (v.hasDefault && !existing.defaultValue) {
            existing.defaultValue = v.defaultValue;
            existing.required = false;
          }
        } else {
          vars.set(v.name, {
            name: v.name,
            type: inferType(v.name, v.defaultValue),
            required: !v.hasDefault,
            defaultValue: v.defaultValue,
            files: [{ path: v.filePath, line: v.line }],
          });
        }
      }

      this.state.variables = vars;
      this.state.lastScan = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  getEnvFileVars(cwd: string): Map<string, string> {
    const envPath = path.join(cwd, ".env");
    const vars = new Map<string, string>();
    if (!fs.existsSync(envPath)) return vars;

    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const stripped = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
      const eq = stripped.indexOf("=");
      if (eq === -1) continue;
      const key = stripped.slice(0, eq).trim();
      let value = stripped.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars.set(key, value);
    }
    return vars;
  }

  getMissingVars(cwd: string): string[] {
    const envVars = this.getEnvFileVars(cwd);
    const missing: string[] = [];
    for (const [name, info] of this.state.variables) {
      if (info.required && !info.defaultValue && !envVars.has(name)) {
        missing.push(name);
      }
    }
    return missing;
  }

  getExtraVars(cwd: string): string[] {
    const envVars = this.getEnvFileVars(cwd);
    const extra: string[] = [];
    for (const key of envVars.keys()) {
      if (!this.state.variables.has(key)) {
        extra.push(key);
      }
    }
    return extra;
  }
}

function inferType(name: string, defaultValue?: string): string {
  if (/PORT$/i.test(name) || name === "PORT") return "port";
  if (/(_URL|_URI)$/i.test(name) || /^(DATABASE_URL|REDIS_URL|API_URL|BASE_URL)$/.test(name)) return "url";
  if (/(_EMAIL|^EMAIL$|^SMTP_FROM$|^MAIL_FROM$|^REPLY_TO$)/i.test(name)) return "email";
  if (/^(DEBUG|VERBOSE)$/.test(name) || /^(IS_|HAS_|ENABLE_|USE_)/.test(name) || /(_ENABLED?|_DISABLED?|_DEBUG)$/i.test(name)) return "boolean";
  if (/(_COUNT|_SIZE|_LIMIT|_TIMEOUT|_TTL|_MAX|_MIN|_RETRIES|_INTERVAL)$/i.test(name)) return "number";
  if (name === "NODE_ENV") return "enum";
  if (defaultValue === "true" || defaultValue === "false") return "boolean";
  if (defaultValue && /^\d+$/.test(defaultValue)) return "number";
  return "string";
}
