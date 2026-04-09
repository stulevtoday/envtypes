import type { EnvVarSchema, EnvVarUsage } from "./types.js";
import type { FrameworkInfo } from "./frameworks.js";
import type { SecurityIssue } from "./security.js";
import type { ValidationResult } from "./types.js";
import type { SyncResult } from "./sync.js";
import { classifyVariable } from "./frameworks.js";
import { inferType } from "./schema.js";

export interface AuditInput {
  schemas: EnvVarSchema[];
  usages: EnvVarUsage[];
  frameworks: FrameworkInfo[];
  securityIssues: SecurityIssue[];
  validations: Map<string, ValidationResult>;
  sync: SyncResult | null;
  scanDuration: number;
}

export function generateAuditReport(input: AuditInput): string {
  const {
    schemas, usages, frameworks, securityIssues,
    validations, sync, scanDuration,
  } = input;

  const lines: string[] = [];
  const date = new Date().toISOString().split("T")[0];

  lines.push("# Environment Variables Audit Report");
  lines.push("");
  lines.push(`**Generated**: ${date}  `);
  lines.push(`**Tool**: envtypes v0.1.0  `);
  if (frameworks.length > 0) {
    lines.push(`**Frameworks**: ${frameworks.map((f) => f.name).join(", ")}  `);
  }
  lines.push(`**Scan duration**: ${Math.round(scanDuration)}ms  `);
  lines.push("");

  // Summary
  const required = schemas.filter((s) => s.required);
  const optional = schemas.filter((s) => !s.required);
  const criticals = securityIssues.filter((i) => i.severity === "critical");
  const warnings = securityIssues.filter((i) => i.severity === "warning");

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total variables | ${schemas.length} |`);
  lines.push(`| Required | ${required.length} |`);
  lines.push(`| Optional | ${optional.length} |`);
  lines.push(`| Security issues (critical) | ${criticals.length} |`);
  lines.push(`| Security issues (warning) | ${warnings.length} |`);
  lines.push(`| Files scanned | ${new Set(usages.map((u) => u.filePath)).size} |`);
  lines.push("");

  // Variables table
  lines.push("## Variables");
  lines.push("");
  lines.push("| Variable | Type | Required | Default | Scope | Files |");
  lines.push("|----------|------|----------|---------|-------|-------|");

  for (const schema of schemas) {
    const scope = frameworks.length > 0
      ? classifyVariable(schema.name, frameworks)
      : "-";
    const files = [...new Set(
      usages.filter((u) => u.name === schema.name).map((u) => u.filePath)
    )];
    const fileList = files.length <= 2
      ? files.join(", ")
      : `${files[0]} (+${files.length - 1})`;

    lines.push(
      `| \`${schema.name}\` | ${schema.type} | ${schema.required ? "yes" : "no"} | ${schema.defaultValue ?? "-"} | ${scope} | ${fileList} |`
    );
  }
  lines.push("");

  // Security section
  if (securityIssues.length > 0) {
    lines.push("## Security Issues");
    lines.push("");

    for (const issue of securityIssues) {
      const icon = issue.severity === "critical" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
      lines.push(`### ${icon} ${issue.severity.toUpperCase()}: ${issue.variable}`);
      lines.push("");
      lines.push(`**Rule**: \`${issue.rule}\`  `);
      lines.push(`**Detail**: ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`**Fix**: ${issue.suggestion}`);
      }
      lines.push("");
    }
  } else {
    lines.push("## Security");
    lines.push("");
    lines.push("No security issues found.");
    lines.push("");
  }

  // Validation per file
  if (validations.size > 0) {
    lines.push("## Validation Results");
    lines.push("");

    for (const [fileName, result] of validations) {
      if (result.valid && result.extra.length === 0) {
        lines.push(`- **${fileName}**: ✅ valid`);
      } else {
        lines.push(`- **${fileName}**:`);
        for (const name of result.missing) {
          lines.push(`  - ❌ \`${name}\` — missing (required)`);
        }
        for (const err of result.errors.filter((e) => e.severity === "error" && !result.missing.includes(e.variable))) {
          lines.push(`  - ❌ ${err.message}`);
        }
        for (const name of result.extra) {
          lines.push(`  - ⚠️ \`${name}\` — defined but not in code`);
        }
      }
    }
    lines.push("");
  }

  // Sync
  if (sync) {
    lines.push("## .env.example Sync");
    lines.push("");
    if (sync.inSync) {
      lines.push("✅ `.env.example` is in sync with codebase.");
    } else {
      if (sync.missingFromExample.length > 0) {
        lines.push(`Missing from .env.example: ${sync.missingFromExample.map((n) => `\`${n}\``).join(", ")}`);
      }
      if (sync.extraInExample.length > 0) {
        lines.push(`Extra in .env.example: ${sync.extraInExample.map((n) => `\`${n}\``).join(", ")}`);
      }
    }
    lines.push("");
  }

  // Usage map
  lines.push("## Usage Map");
  lines.push("");
  lines.push("Where each variable is referenced:");
  lines.push("");

  const grouped = new Map<string, EnvVarUsage[]>();
  for (const u of usages) {
    const arr = grouped.get(u.name) ?? [];
    arr.push(u);
    grouped.set(u.name, arr);
  }

  for (const [name, uses] of grouped) {
    lines.push(`<details><summary><code>${name}</code> (${uses.length} reference${uses.length > 1 ? "s" : ""})</summary>`);
    lines.push("");
    for (const u of uses) {
      lines.push(`- \`${u.filePath}:${u.line}\` — ${u.accessPattern}${u.hasDefault ? ` (default: ${u.defaultValue})` : ""}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  return lines.join("\n");
}
