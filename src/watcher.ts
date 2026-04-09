import fs from "node:fs";
import path from "node:path";
import { scan } from "./scanner.js";
import { generateSchema } from "./schema.js";
import { validate, parseEnvFile, findEnvFiles } from "./validator.js";
import { analyzeSecurityIssues } from "./security.js";
import { detectFrameworks } from "./frameworks.js";
import { loadConfig } from "./config.js";
import type { ScanResult } from "./types.js";

export interface WatchOptions {
  cwd: string;
  onResult: (report: WatchReport) => void;
  debounceMs?: number;
}

export interface WatchReport {
  scan: ScanResult;
  validationErrors: number;
  securityIssues: number;
  totalVariables: number;
}

export function watch(options: WatchOptions): { close: () => void } {
  const { cwd, onResult, debounceMs = 500 } = options;
  const config = loadConfig(cwd);

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const controllers: AbortController[] = [];

  function runCheck() {
    const result = scan({
      cwd,
      include: config.include,
      exclude: config.exclude,
    });

    const schemas = generateSchema(result.variables, {
      ignore: config.ignore,
      overrides: config.overrides,
    });

    let validationErrors = 0;
    const envFiles = findEnvFiles(cwd);
    for (const envFile of envFiles) {
      const values = parseEnvFile(envFile);
      const vr = validate(schemas, values);
      validationErrors += vr.missing.length + vr.typeErrors.length;
    }

    const { detected: frameworks } = detectFrameworks(cwd);
    const issues = analyzeSecurityIssues(schemas, frameworks);

    onResult({
      scan: result,
      validationErrors,
      securityIssues: issues.filter((i) => i.severity === "critical").length,
      totalVariables: new Set(result.variables.map((v) => v.name)).size,
    });
  }

  function scheduleCheck() {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(runCheck, debounceMs);
  }

  // Initial run
  runCheck();

  // Watch source directories
  const watchPaths = [cwd];
  const srcDir = path.join(cwd, "src");
  if (fs.existsSync(srcDir)) watchPaths.push(srcDir);

  for (const watchPath of watchPaths) {
    try {
      const ac = new AbortController();
      controllers.push(ac);
      fs.watch(watchPath, { recursive: true, signal: ac.signal }, (event, filename) => {
        if (!filename) return;
        const ext = path.extname(filename);

        if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
          scheduleCheck();
        }
        if (filename.startsWith(".env")) {
          scheduleCheck();
        }
      });
    } catch {
      // fs.watch not available on all platforms with recursive
    }
  }

  return {
    close() {
      if (timeout) clearTimeout(timeout);
      for (const ac of controllers) ac.abort();
    },
  };
}
