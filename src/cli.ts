import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { scan } from "./scanner.js";
import { generateSchema, schemaToTypenvFile } from "./schema.js";
import { validate, parseEnvFile, findEnvFiles } from "./validator.js";
import { generateEnvModule, generateEnvExample } from "./generator.js";
import { detectFrameworks, classifyVariable } from "./frameworks.js";
import { analyzeSecurityIssues } from "./security.js";
import { checkExampleSync, findExampleFile } from "./sync.js";
import { loadConfig, generateConfigFile } from "./config.js";
import { watch as startWatch } from "./watcher.js";
import { generateAuditReport } from "./audit.js";
import type { EnvVarUsage, EnvVarSchema } from "./types.js";
import type { FrameworkInfo } from "./frameworks.js";

const program = new Command();

program
  .name("envtypes")
  .description("Type-safe environment variables. Scan code, generate schemas, validate .env files.")
  .version("0.1.0");

// --- scan ---

program
  .command("scan")
  .description("Discover environment variables used in your codebase")
  .option("-d, --dir <path>", "Project directory to scan", ".")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const { detected: frameworks } = detectFrameworks(cwd);

    if (frameworks.length > 0) {
      const names = frameworks.map((f) => chalk.cyan(f.name)).join(", ");
      console.log(chalk.blue("Framework:"), names);
    }
    console.log(chalk.blue("Scanning"), cwd, "\n");

    const result = scan({ cwd });

    if (result.variables.length === 0) {
      console.log(chalk.yellow("No environment variables found."));
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const grouped = groupByName(result.variables);
    const required = [...grouped.entries()].filter(
      ([, usages]) => !usages.some((u) => u.hasDefault)
    );
    const optional = [...grouped.entries()].filter(([, usages]) =>
      usages.some((u) => u.hasDefault)
    );

    console.log(
      chalk.bold(`Found ${chalk.green(grouped.size)} unique variables`),
      `in ${result.files.length} files`,
      chalk.dim(`(${Math.round(result.duration)}ms)`),
      "\n"
    );

    if (required.length > 0) {
      console.log(chalk.red.bold("Required:"));
      for (const [name, usages] of required) {
        printVariable(name, usages, frameworks);
      }
      console.log();
    }

    if (optional.length > 0) {
      console.log(chalk.yellow.bold("Optional (has defaults):"));
      for (const [name, usages] of optional) {
        printVariable(name, usages, frameworks);
      }
    }

    if (frameworks.length > 0) {
      const clientVars = [...grouped.keys()].filter(
        (n) => classifyVariable(n, frameworks) === "client"
      );
      const serverVars = [...grouped.keys()].filter(
        (n) => classifyVariable(n, frameworks) === "server"
      );
      if (clientVars.length > 0 || serverVars.length > 0) {
        console.log(chalk.bold("\nScope analysis:"));
        if (clientVars.length > 0) {
          console.log(
            chalk.cyan(`  Client-exposed (${clientVars.length}):`),
            clientVars.join(", ")
          );
        }
        if (serverVars.length > 0) {
          console.log(
            chalk.magenta(`  Server-only (${serverVars.length}):`),
            serverVars.join(", ")
          );
        }
      }
    }
  });

// --- init ---

program
  .command("init")
  .description("Generate an .envtypes.ts schema from scanning your codebase")
  .option("-d, --dir <path>", "Project directory", ".")
  .option("-o, --output <path>", "Output schema file", ".envtypes.ts")
  .option("--force", "Overwrite existing schema file")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const outputPath = path.resolve(cwd, opts.output);

    if (fs.existsSync(outputPath) && !opts.force) {
      console.log(
        chalk.red(`${opts.output} already exists. Use --force to overwrite.`)
      );
      process.exit(1);
    }

    console.log(chalk.blue("Scanning"), cwd, "\n");
    const result = scan({ cwd });

    if (result.variables.length === 0) {
      console.log(chalk.yellow("No environment variables found. Nothing to generate."));
      return;
    }

    const schemas = generateSchema(result.variables);
    const content = schemaToTypenvFile(schemas);

    fs.writeFileSync(outputPath, content, "utf-8");
    console.log(
      chalk.green(`Generated ${opts.output}`),
      `with ${schemas.length} variables\n`
    );

    for (const schema of schemas) {
      const tag = schema.required
        ? chalk.red("required")
        : chalk.yellow("optional");
      console.log(`  ${chalk.bold(schema.name)} ${chalk.dim(schema.type)} [${tag}]`);
    }
  });

// --- check ---

program
  .command("check")
  .description("Validate .env files against your schema")
  .option("-d, --dir <path>", "Project directory", ".")
  .option("-e, --env <path>", "Specific .env file to check")
  .option("--ci", "Exit with code 1 on validation errors")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const config = loadConfig(cwd);

    console.log(chalk.blue("Scanning codebase for env var usage..."), "\n");
    const result = scan({
      cwd,
      include: config.include,
      exclude: config.exclude,
    });

    if (result.variables.length === 0) {
      console.log(chalk.yellow("No environment variables found in code."));
      return;
    }

    const schemas = generateSchema(result.variables, {
      ignore: config.ignore,
      overrides: config.overrides,
    });
    const schemaMap = new Map(schemas.map((s) => [s.name, s]));

    const envFiles = opts.env
      ? [path.resolve(cwd, opts.env)]
      : findEnvFiles(cwd);

    if (envFiles.length === 0) {
      console.log(chalk.yellow("No .env files found.\n"));
      console.log(chalk.dim("Tip: create a .env file with the following required variables:\n"));
      for (const s of schemas.filter((s) => s.required)) {
        console.log(chalk.dim(`  ${s.name}=`));
      }
      if (opts.ci) process.exit(1);
      return;
    }

    let hasErrors = false;

    for (const envFile of envFiles) {
      const fileName = path.relative(cwd, envFile);
      const values = parseEnvFile(envFile);
      const validationResult = validate(schemas, values);

      if (validationResult.valid && validationResult.extra.length === 0) {
        console.log(chalk.green(`✓ ${fileName}`), "— all good");
        continue;
      }

      console.log(chalk.bold(fileName));

      if (validationResult.missing.length > 0) {
        hasErrors = true;
        for (const name of validationResult.missing) {
          const s = schemaMap.get(name);
          const hint = s ? suggestValue(s) : "";
          console.log(chalk.red(`  ✗ ${name} — missing (required)`));
          if (hint) console.log(chalk.dim(`    add: ${name}=${hint}`));
        }
      }

      if (validationResult.typeErrors.length > 0) {
        hasErrors = true;
        const typeErrs = validationResult.errors.filter(
          (e) => e.severity === "error" && !validationResult.missing.includes(e.variable)
        );
        for (const err of typeErrs) {
          const s = schemaMap.get(err.variable);
          console.log(chalk.red(`  ✗ ${err.message}`));
          if (s) {
            console.log(chalk.dim(`    expected: ${describeExpectedType(s)}`));
          }
        }
      }

      if (validationResult.extra.length > 0) {
        for (const name of validationResult.extra) {
          console.log(chalk.yellow(`  ? ${name} — defined but not referenced in code`));
          console.log(chalk.dim(`    safe to remove, or add to "ignore" in .envtypes.json`));
        }
      }

      console.log();
    }

    if (hasErrors && opts.ci) {
      process.exit(1);
    }
  });

// --- generate ---

program
  .command("generate")
  .description("Generate a type-safe env access module and .env.example")
  .option("-d, --dir <path>", "Project directory", ".")
  .option("-o, --output <path>", "Output module path")
  .option("--no-example", "Skip generating .env.example")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const config = loadConfig(cwd);
    const outputFile = opts.output ?? config.output ?? "src/env.ts";

    console.log(chalk.blue("Scanning codebase..."), "\n");
    const result = scan({
      cwd,
      include: config.include,
      exclude: config.exclude,
    });

    if (result.variables.length === 0) {
      console.log(chalk.yellow("No environment variables found."));
      return;
    }

    const schemas = generateSchema(result.variables, {
      ignore: config.ignore,
      overrides: config.overrides,
    });

    const modulePath = path.resolve(cwd, outputFile);
    const moduleDir = path.dirname(modulePath);
    if (!fs.existsSync(moduleDir)) {
      fs.mkdirSync(moduleDir, { recursive: true });
    }

    const moduleContent = generateEnvModule(schemas);
    fs.writeFileSync(modulePath, moduleContent, "utf-8");
    console.log(chalk.green(`Generated ${outputFile}`));

    if (opts.example !== false) {
      const exampleFile = config.exampleOutput ?? ".env.example";
      const examplePath = path.resolve(cwd, exampleFile);
      const exampleContent = generateEnvExample(schemas);
      fs.writeFileSync(examplePath, exampleContent, "utf-8");
      console.log(chalk.green(`Generated ${exampleFile}`));
    }

    console.log(
      chalk.dim(`\nUsage: import { env } from "${outputFile.replace(/\.ts$/, ".js")}";`)
    );
    console.log(chalk.dim("Then access: env.DATABASE_URL, env.PORT, etc."));
  });

// --- doctor ---

program
  .command("doctor")
  .description("Run all checks: validation, security, sync — in one pass")
  .option("-d, --dir <path>", "Project directory", ".")
  .option("--ci", "Exit with code 1 on any errors")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const { detected: frameworks } = detectFrameworks(cwd);
    let exitCode = 0;

    if (frameworks.length > 0) {
      const names = frameworks.map((f) => chalk.cyan(f.name)).join(", ");
      console.log(chalk.blue("Framework:"), names);
    }
    console.log(chalk.blue("Scanning"), cwd, "\n");

    const result = scan({ cwd });
    if (result.variables.length === 0) {
      console.log(chalk.yellow("No environment variables found."));
      return;
    }

    const schemas = generateSchema(result.variables);
    const grouped = groupByName(result.variables);
    console.log(
      chalk.bold(`Found ${chalk.green(grouped.size)} variables`),
      `in ${result.files.length} files`,
      chalk.dim(`(${Math.round(result.duration)}ms)\n`)
    );

    // 1. .env validation
    const envFiles = findEnvFiles(cwd);
    if (envFiles.length > 0) {
      console.log(chalk.bold.underline("Validation"));
      for (const envFile of envFiles) {
        const fileName = path.relative(cwd, envFile);
        const values = parseEnvFile(envFile);
        const vr = validate(schemas, values);

        if (vr.valid && vr.extra.length === 0) {
          console.log(chalk.green(`  ✓ ${fileName}`));
        } else {
          if (vr.missing.length > 0 || vr.typeErrors.length > 0) exitCode = 1;
          for (const name of vr.missing) {
            console.log(chalk.red(`  ✗ ${fileName}: ${name} — missing (required)`));
          }
          const typeErrs = vr.errors.filter(
            (e) => e.severity === "error" && !vr.missing.includes(e.variable)
          );
          for (const err of typeErrs) {
            console.log(chalk.red(`  ✗ ${fileName}: ${err.message}`));
          }
          for (const name of vr.extra) {
            console.log(chalk.yellow(`  ? ${fileName}: ${name} — not in code`));
          }
        }
      }
      console.log();
    } else {
      console.log(chalk.yellow("No .env files found.\n"));
    }

    // 2. Security analysis
    const envValues = envFiles.length > 0
      ? parseEnvFile(envFiles[0])
      : undefined;
    const issues = analyzeSecurityIssues(schemas, frameworks, envValues);

    if (issues.length > 0) {
      console.log(chalk.bold.underline("Security"));
      for (const issue of issues) {
        const icon =
          issue.severity === "critical" ? chalk.red("✗") :
          issue.severity === "warning" ? chalk.yellow("!") :
          chalk.blue("i");

        const label =
          issue.severity === "critical" ? chalk.red.bold("CRITICAL") :
          issue.severity === "warning" ? chalk.yellow.bold("WARNING") :
          chalk.blue("INFO");

        console.log(`  ${icon} ${label} ${issue.message}`);
        if (issue.suggestion) {
          console.log(chalk.dim(`    → ${issue.suggestion}`));
        }

        if (issue.severity === "critical") exitCode = 1;
      }
      console.log();
    } else {
      console.log(chalk.bold.underline("Security"));
      console.log(chalk.green("  ✓ No security issues found\n"));
    }

    // 3. .env.example sync
    const exampleFile = findExampleFile(cwd);
    console.log(chalk.bold.underline("Sync"));
    if (exampleFile) {
      const sync = checkExampleSync(schemas, exampleFile);
      if (sync && sync.inSync) {
        console.log(chalk.green(`  ✓ ${path.relative(cwd, exampleFile)} is in sync`));
      } else if (sync) {
        for (const name of sync.missingFromExample) {
          console.log(chalk.red(`  ✗ ${name} — missing from .env.example`));
        }
        for (const name of sync.extraInExample) {
          console.log(chalk.yellow(`  ? ${name} — in .env.example but not in code`));
        }
        for (const s of sync.staleDefaults) {
          console.log(chalk.yellow(`  ! ${s.variable} — example has "${s.exampleValue}", code defaults to "${s.schemaDefault}"`));
        }
      }
    } else {
      console.log(chalk.yellow("  No .env.example found. Run"), chalk.bold("envtypes generate"), chalk.yellow("to create one."));
    }

    // Summary
    const criticals = issues.filter((i) => i.severity === "critical").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    console.log(chalk.bold("\n───────────────────────────────────"));
    if (exitCode === 0) {
      console.log(chalk.green.bold("  All checks passed"));
    } else {
      console.log(chalk.red.bold(`  ${criticals} critical issue(s)`), warnings > 0 ? chalk.yellow(`  ${warnings} warning(s)`) : "");
    }
    console.log(chalk.bold("───────────────────────────────────"));

    if (opts.ci && exitCode > 0) process.exit(exitCode);
  });

// --- diff ---

program
  .command("diff <file1> <file2>")
  .description("Compare two .env files and show differences")
  .action((file1: string, file2: string) => {
    const env1 = parseEnvFile(path.resolve(file1));
    const env2 = parseEnvFile(path.resolve(file2));
    const name1 = path.basename(file1);
    const name2 = path.basename(file2);

    const allKeys = new Set([...env1.keys(), ...env2.keys()]);
    const onlyIn1: string[] = [];
    const onlyIn2: string[] = [];
    const different: { key: string; val1: string; val2: string }[] = [];
    let same = 0;

    for (const key of [...allKeys].sort()) {
      const v1 = env1.get(key);
      const v2 = env2.get(key);

      if (v1 !== undefined && v2 === undefined) {
        onlyIn1.push(key);
      } else if (v1 === undefined && v2 !== undefined) {
        onlyIn2.push(key);
      } else if (v1 !== v2) {
        different.push({ key, val1: v1!, val2: v2! });
      } else {
        same++;
      }
    }

    console.log(chalk.bold(`Comparing ${name1} ↔ ${name2}\n`));

    if (onlyIn1.length > 0) {
      console.log(chalk.red(`Only in ${name1}:`));
      for (const key of onlyIn1) {
        console.log(chalk.red(`  - ${key}`));
      }
      console.log();
    }

    if (onlyIn2.length > 0) {
      console.log(chalk.green(`Only in ${name2}:`));
      for (const key of onlyIn2) {
        console.log(chalk.green(`  + ${key}`));
      }
      console.log();
    }

    if (different.length > 0) {
      console.log(chalk.yellow("Different values:"));
      for (const { key, val1, val2 } of different) {
        const masked1 = maskValue(key, val1);
        const masked2 = maskValue(key, val2);
        console.log(`  ${chalk.bold(key)}`);
        console.log(chalk.red(`    ${name1}: ${masked1}`));
        console.log(chalk.green(`    ${name2}: ${masked2}`));
      }
      console.log();
    }

    console.log(
      chalk.dim(`${same} identical · ${different.length} different · ${onlyIn1.length} only in ${name1} · ${onlyIn2.length} only in ${name2}`)
    );
  });

// --- audit ---

program
  .command("audit")
  .description("Generate a full markdown audit report of all environment variables")
  .option("-d, --dir <path>", "Project directory", ".")
  .option("-o, --output <path>", "Output file (default: stdout)")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const config = loadConfig(cwd);
    const { detected: frameworks } = detectFrameworks(cwd);

    const result = scan({
      cwd,
      include: config.include,
      exclude: config.exclude,
    });

    if (result.variables.length === 0) {
      console.log(chalk.yellow("No environment variables found."));
      return;
    }

    const schemas = generateSchema(result.variables, {
      ignore: config.ignore,
      overrides: config.overrides,
    });

    const envFiles = findEnvFiles(cwd);
    const validations = new Map<string, ReturnType<typeof validate>>();
    for (const envFile of envFiles) {
      const fileName = path.relative(cwd, envFile);
      const values = parseEnvFile(envFile);
      validations.set(fileName, validate(schemas, values));
    }

    const envValues = envFiles.length > 0 ? parseEnvFile(envFiles[0]) : undefined;
    const securityIssues = analyzeSecurityIssues(schemas, frameworks, envValues);

    const exampleFile = findExampleFile(cwd);
    const sync = exampleFile ? checkExampleSync(schemas, exampleFile) : null;

    const report = generateAuditReport({
      schemas,
      usages: result.variables,
      frameworks,
      securityIssues,
      validations,
      sync,
      scanDuration: result.duration,
    });

    if (opts.output) {
      const outPath = path.resolve(cwd, opts.output);
      fs.writeFileSync(outPath, report, "utf-8");
      console.log(chalk.green(`Audit report written to ${opts.output}`));
    } else {
      console.log(report);
    }
  });

// --- watch ---

program
  .command("watch")
  .description("Watch for changes and validate continuously")
  .option("-d, --dir <path>", "Project directory", ".")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    console.log(chalk.blue("Watching"), cwd, chalk.dim("(Ctrl+C to stop)\n"));

    let firstRun = true;

    const watcher = startWatch({
      cwd,
      onResult(report) {
        const time = new Date().toLocaleTimeString();
        const varCount = chalk.green(String(report.totalVariables));
        const errors = report.validationErrors;
        const security = report.securityIssues;

        if (!firstRun) {
          console.log(chalk.dim(`\n[${time}] File changed, re-scanning...`));
        }
        firstRun = false;

        const parts = [`${varCount} variables`];
        if (errors > 0) {
          parts.push(chalk.red(`${errors} error(s)`));
        }
        if (security > 0) {
          parts.push(chalk.red(`${security} critical`));
        }
        if (errors === 0 && security === 0) {
          parts.push(chalk.green("all good"));
        }

        console.log(
          chalk.dim(`[${time}]`),
          parts.join(chalk.dim(" · ")),
          chalk.dim(`(${Math.round(report.scan.duration)}ms)`)
        );
      },
    });

    process.on("SIGINT", () => {
      watcher.close();
      console.log(chalk.dim("\nStopped watching."));
      process.exit(0);
    });
  });

// --- helpers ---

function suggestValue(schema: EnvVarSchema): string {
  switch (schema.type) {
    case "port": return "3000";
    case "boolean": return "true";
    case "number": return "0";
    case "url": return "https://...";
    case "enum": return schema.enumValues?.[0] ?? "";
    case "string": return `<your ${schema.name.toLowerCase()}>`;
  }
}

function describeExpectedType(schema: EnvVarSchema): string {
  switch (schema.type) {
    case "port": return "integer 0-65535";
    case "boolean": return "true/false/1/0/yes/no";
    case "number": return "numeric value";
    case "url": return "valid URL (https://...)";
    case "enum": return `one of: ${schema.enumValues?.join(", ") ?? ""}`;
    case "string": return "any string";
  }
}

function maskValue(key: string, value: string): string {
  const sensitiveHints = [
    "SECRET", "PASSWORD", "TOKEN", "KEY", "PRIVATE",
    "CREDENTIAL", "AUTH",
  ];
  const isSensitive = sensitiveHints.some((h) => key.toUpperCase().includes(h));

  if (!isSensitive) return value;
  if (value.length <= 4) return "****";
  return value.slice(0, 2) + "*".repeat(Math.min(value.length - 4, 20)) + value.slice(-2);
}

function groupByName(usages: EnvVarUsage[]): Map<string, EnvVarUsage[]> {
  const map = new Map<string, EnvVarUsage[]>();
  for (const u of usages) {
    const arr = map.get(u.name) ?? [];
    arr.push(u);
    map.set(u.name, arr);
  }
  return map;
}

function printVariable(
  name: string,
  usages: EnvVarUsage[],
  frameworks: FrameworkInfo[] = []
): void {
  const files = [...new Set(usages.map((u) => u.filePath))];
  const defaultVal = usages.find((u) => u.defaultValue)?.defaultValue;
  const defaultNote = defaultVal ? chalk.dim(` (default: ${defaultVal})`) : "";

  const scope = frameworks.length > 0 ? classifyVariable(name, frameworks) : null;
  const scopeTag =
    scope === "client"
      ? chalk.cyan(" [client]")
      : scope === "server"
        ? chalk.magenta(" [server]")
        : "";

  console.log(`  ${chalk.bold(name)}${defaultNote}${scopeTag}`);
  for (const file of files) {
    const linesInFile = usages
      .filter((u) => u.filePath === file)
      .map((u) => u.line);
    console.log(chalk.dim(`    ${file}:${linesInFile.join(",")}`));
  }
}

program.parse();
