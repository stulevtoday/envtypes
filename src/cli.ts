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
import { detectMigrationSource, migrateFromSource } from "./migrate.js";
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
  .option("--json", "Output results as JSON")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const config = loadConfig(cwd);

    if (!opts.json) {
      console.log(chalk.blue("Scanning codebase for env var usage..."), "\n");
    }
    const result = scan({
      cwd,
      include: config.include,
      exclude: config.exclude,
    });

    if (result.variables.length === 0) {
      if (opts.json) { console.log(JSON.stringify({ files: [], variables: 0, results: [] })); return; }
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
      if (opts.json) {
        console.log(JSON.stringify({ files: [], variables: schemas.length, results: [], error: "no-env-files" }));
        if (opts.ci) process.exit(1);
        return;
      }
      console.log(chalk.yellow("No .env files found.\n"));
      console.log(chalk.dim("Tip: create a .env file with the following required variables:\n"));
      for (const s of schemas.filter((s) => s.required)) {
        console.log(chalk.dim(`  ${s.name}=`));
      }
      if (opts.ci) process.exit(1);
      return;
    }

    let hasErrors = false;
    const jsonResults: Array<{ file: string; valid: boolean; missing: string[]; typeErrors: string[]; extra: string[] }> = [];

    for (const envFile of envFiles) {
      const fileName = path.relative(cwd, envFile);
      const values = parseEnvFile(envFile);
      const validationResult = validate(schemas, values);

      if (opts.json) {
        jsonResults.push({
          file: fileName,
          valid: validationResult.valid,
          missing: validationResult.missing,
          typeErrors: validationResult.typeErrors,
          extra: validationResult.extra,
        });
        if (!validationResult.valid) hasErrors = true;
        continue;
      }

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

    if (opts.json) {
      console.log(JSON.stringify({
        variables: schemas.length,
        files: envFiles.map((f) => path.relative(cwd, f)),
        valid: !hasErrors,
        results: jsonResults,
      }));
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
  .option("--json", "Output results as JSON")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const { detected: frameworks } = detectFrameworks(cwd);
    let exitCode = 0;

    if (!opts.json) {
      if (frameworks.length > 0) {
        const names = frameworks.map((f) => chalk.cyan(f.name)).join(", ");
        console.log(chalk.blue("Framework:"), names);
      }
      console.log(chalk.blue("Scanning"), cwd, "\n");
    }

    const result = scan({ cwd });
    if (result.variables.length === 0) {
      if (opts.json) { console.log(JSON.stringify({ variables: 0, valid: true, validation: [], security: [], sync: null })); return; }
      console.log(chalk.yellow("No environment variables found."));
      return;
    }

    const schemas = generateSchema(result.variables);
    const grouped = groupByName(result.variables);

    if (!opts.json) {
      console.log(
        chalk.bold(`Found ${chalk.green(grouped.size)} variables`),
        `in ${result.files.length} files`,
        chalk.dim(`(${Math.round(result.duration)}ms)\n`)
      );
    }

    // 1. .env validation
    const envFiles = findEnvFiles(cwd);
    const jsonValidation: Array<{ file: string; valid: boolean; missing: string[]; typeErrors: string[]; extra: string[] }> = [];

    if (envFiles.length > 0) {
      if (!opts.json) console.log(chalk.bold.underline("Validation"));
      for (const envFile of envFiles) {
        const fileName = path.relative(cwd, envFile);
        const values = parseEnvFile(envFile);
        const vr = validate(schemas, values);

        jsonValidation.push({ file: fileName, valid: vr.valid, missing: vr.missing, typeErrors: vr.typeErrors, extra: vr.extra });

        if (opts.json) {
          if (!vr.valid) exitCode = 1;
          continue;
        }

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
      if (!opts.json) console.log();
    } else {
      if (!opts.json) console.log(chalk.yellow("No .env files found.\n"));
    }

    // 2. Security analysis
    const envValues = envFiles.length > 0
      ? parseEnvFile(envFiles[0])
      : undefined;
    const issues = analyzeSecurityIssues(schemas, frameworks, envValues, cwd);

    if (!opts.json) {
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
    } else {
      if (issues.some((i) => i.severity === "critical")) exitCode = 1;
    }

    // 3. .env.example sync
    const exampleFile = findExampleFile(cwd);
    let syncResult: ReturnType<typeof checkExampleSync> = null;

    if (!opts.json) {
      console.log(chalk.bold.underline("Sync"));
    }

    if (exampleFile) {
      syncResult = checkExampleSync(schemas, exampleFile);
      if (!opts.json) {
        if (syncResult && syncResult.inSync) {
          console.log(chalk.green(`  ✓ ${path.relative(cwd, exampleFile)} is in sync`));
        } else if (syncResult) {
          for (const name of syncResult.missingFromExample) {
            console.log(chalk.red(`  ✗ ${name} — missing from .env.example`));
          }
          for (const name of syncResult.extraInExample) {
            console.log(chalk.yellow(`  ? ${name} — in .env.example but not in code`));
          }
          for (const s of syncResult.staleDefaults) {
            console.log(chalk.yellow(`  ! ${s.variable} — example has "${s.exampleValue}", code defaults to "${s.schemaDefault}"`));
          }
        }
      }
    } else if (!opts.json) {
      console.log(chalk.yellow("  No .env.example found. Run"), chalk.bold("envtypes generate"), chalk.yellow("to create one."));
    }

    // Summary / JSON output
    const criticals = issues.filter((i) => i.severity === "critical").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;

    if (opts.json) {
      console.log(JSON.stringify({
        variables: grouped.size,
        files: result.files.length,
        frameworks: frameworks.map((f) => f.name),
        duration: Math.round(result.duration),
        valid: exitCode === 0,
        validation: jsonValidation,
        security: issues.map((i) => ({ variable: i.variable, severity: i.severity, rule: i.rule, message: i.message })),
        sync: syncResult ? { inSync: syncResult.inSync, missingFromExample: syncResult.missingFromExample, extraInExample: syncResult.extraInExample } : null,
      }));
    } else {
      console.log(chalk.bold("\n───────────────────────────────────"));
      if (exitCode === 0) {
        console.log(chalk.green.bold("  All checks passed"));
      } else {
        console.log(chalk.red.bold(`  ${criticals} critical issue(s)`), warnings > 0 ? chalk.yellow(`  ${warnings} warning(s)`) : "");
      }
      console.log(chalk.bold("───────────────────────────────────"));
    }

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

// --- compare ---

program
  .command("compare")
  .description("Show a matrix of env vars across multiple .env files")
  .argument("<files...>", "Two or more .env files to compare")
  .option("--json", "Output as JSON")
  .action((files: string[], opts) => {
    if (files.length < 2) {
      console.log(chalk.red("Provide at least two .env files to compare."));
      process.exit(1);
    }

    const envMaps: Array<{ name: string; env: Map<string, string> }> = [];
    for (const file of files) {
      const resolved = path.resolve(file);
      if (!fs.existsSync(resolved)) {
        console.log(chalk.red(`File not found: ${file}`));
        process.exit(1);
      }
      envMaps.push({ name: path.basename(file), env: parseEnvFile(resolved) });
    }

    const allKeys = new Set<string>();
    for (const { env } of envMaps) {
      for (const key of env.keys()) allKeys.add(key);
    }
    const sortedKeys = [...allKeys].sort();

    if (opts.json) {
      const matrix: Record<string, Record<string, string | null>> = {};
      for (const key of sortedKeys) {
        matrix[key] = {};
        for (const { name, env } of envMaps) {
          const val = env.get(key);
          matrix[key][name] = val !== undefined ? maskValue(key, val) : null;
        }
      }
      console.log(JSON.stringify({ files: envMaps.map((e) => e.name), variables: sortedKeys.length, matrix }));
      return;
    }

    const colWidth = Math.max(12, ...envMaps.map((e) => e.name.length + 2));
    const keyWidth = Math.max(20, ...sortedKeys.map((k) => k.length + 2));

    const header = chalk.bold("Variable".padEnd(keyWidth)) + envMaps.map((e) => chalk.bold(e.name.padEnd(colWidth))).join("");
    console.log(header);
    console.log("─".repeat(keyWidth + colWidth * envMaps.length));

    for (const key of sortedKeys) {
      const cells = envMaps.map(({ env }) => {
        const val = env.get(key);
        if (val === undefined) return chalk.red("✗".padEnd(colWidth));
        return chalk.green(maskValue(key, val).slice(0, colWidth - 2).padEnd(colWidth));
      });
      console.log(key.padEnd(keyWidth) + cells.join(""));
    }

    console.log("─".repeat(keyWidth + colWidth * envMaps.length));
    const coverage = envMaps.map(({ name, env }) => {
      const present = sortedKeys.filter((k) => env.has(k)).length;
      const pct = Math.round((present / sortedKeys.length) * 100);
      return `${name}: ${present}/${sortedKeys.length} (${pct}%)`;
    });
    console.log(chalk.dim(`Coverage: ${coverage.join("  ·  ")}`));
  });

// --- audit ---

program
  .command("audit")
  .description("Generate a full markdown audit report of all environment variables")
  .option("-d, --dir <path>", "Project directory", ".")
  .option("-o, --output <path>", "Output file (default: stdout)")
  .option("--json", "Output as structured JSON instead of markdown")
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
      if (opts.json) { console.log(JSON.stringify({ variables: [] })); return; }
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
    const securityIssues = analyzeSecurityIssues(schemas, frameworks, envValues, cwd);

    const exampleFile = findExampleFile(cwd);
    const sync = exampleFile ? checkExampleSync(schemas, exampleFile) : null;

    if (opts.json) {
      const jsonReport = {
        date: new Date().toISOString().split("T")[0],
        frameworks: frameworks.map((f) => f.name),
        duration: Math.round(result.duration),
        variables: schemas.map((s) => ({
          name: s.name,
          type: s.type,
          required: s.required,
          defaultValue: s.defaultValue ?? null,
          files: [...new Set(result.variables.filter((u) => u.name === s.name).map((u) => u.filePath))],
        })),
        security: securityIssues.map((i) => ({ variable: i.variable, severity: i.severity, rule: i.rule, message: i.message })),
        validation: [...validations.entries()].map(([file, vr]) => ({ file, valid: vr.valid, missing: vr.missing, typeErrors: vr.typeErrors })),
        sync: sync ? { inSync: sync.inSync, missingFromExample: sync.missingFromExample, extraInExample: sync.extraInExample } : null,
      };

      const output = JSON.stringify(jsonReport, null, 2);
      if (opts.output) {
        fs.writeFileSync(path.resolve(cwd, opts.output), output, "utf-8");
        console.log(chalk.green(`JSON audit report written to ${opts.output}`));
      } else {
        console.log(output);
      }
      return;
    }

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

// --- hook ---

program
  .command("hook")
  .description("Install or remove a git pre-commit hook for envtypes")
  .argument("<action>", "install or uninstall")
  .option("-d, --dir <path>", "Project directory", ".")
  .action((action: string, opts) => {
    const cwd = path.resolve(opts.dir);
    const hookDir = path.join(cwd, ".git", "hooks");
    const hookPath = path.join(hookDir, "pre-commit");

    if (action === "install") {
      if (!fs.existsSync(path.join(cwd, ".git"))) {
        console.log(chalk.red("Not a git repository. Run git init first."));
        process.exit(1);
      }

      if (!fs.existsSync(hookDir)) {
        fs.mkdirSync(hookDir, { recursive: true });
      }

      const hookContent = [
        "#!/bin/sh",
        '# envtypes pre-commit hook — validates env vars before commit',
        "",
        'npx envtypes doctor --ci',
        'if [ $? -ne 0 ]; then',
        '  echo ""',
        '  echo "envtypes: commit blocked due to env issues. Run npx envtypes doctor to fix."',
        '  exit 1',
        "fi",
        "",
      ].join("\n");

      if (fs.existsSync(hookPath)) {
        const existing = fs.readFileSync(hookPath, "utf-8");
        if (existing.includes("envtypes")) {
          console.log(chalk.yellow("envtypes hook already installed."));
          return;
        }
        fs.appendFileSync(hookPath, "\n" + hookContent);
        console.log(chalk.green("Appended envtypes check to existing pre-commit hook."));
      } else {
        fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
        console.log(chalk.green("Installed pre-commit hook."));
      }

      console.log(chalk.dim("envtypes doctor --ci will run before each commit."));
    } else if (action === "uninstall") {
      if (!fs.existsSync(hookPath)) {
        console.log(chalk.yellow("No pre-commit hook found."));
        return;
      }

      const content = fs.readFileSync(hookPath, "utf-8");
      if (!content.includes("envtypes")) {
        console.log(chalk.yellow("No envtypes hook found in pre-commit."));
        return;
      }

      const cleaned = content
        .split("\n")
        .filter((line) => !line.includes("envtypes"))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");

      if (cleaned.trim() === "#!/bin/sh" || cleaned.trim() === "") {
        fs.unlinkSync(hookPath);
        console.log(chalk.green("Removed pre-commit hook."));
      } else {
        fs.writeFileSync(hookPath, cleaned, { mode: 0o755 });
        console.log(chalk.green("Removed envtypes from pre-commit hook."));
      }
    } else {
      console.log(chalk.red(`Unknown action: ${action}. Use "install" or "uninstall".`));
      process.exit(1);
    }
  });

// --- migrate ---

program
  .command("migrate")
  .description("Import env schema from envalid, znv, or t3-env")
  .option("-d, --dir <path>", "Project directory", ".")
  .option("-s, --source <source>", "Force source: envalid, znv, t3-env")
  .option("-o, --output <path>", "Output schema file", ".envtypes.ts")
  .option("--force", "Overwrite existing schema file")
  .option("--dry-run", "Show what would be generated without writing")
  .action((opts) => {
    const cwd = path.resolve(opts.dir);
    const outputPath = path.resolve(cwd, opts.output);

    if (fs.existsSync(outputPath) && !opts.force && !opts.dryRun) {
      console.log(chalk.red(`${opts.output} already exists. Use --force to overwrite.`));
      process.exit(1);
    }

    const source = opts.source ?? detectMigrationSource(cwd);
    if (!source) {
      console.log(chalk.red("Could not detect migration source."));
      console.log(chalk.dim("Supported: envalid, znv, @t3-oss/env-*"));
      console.log(chalk.dim("Use --source to specify manually."));
      process.exit(1);
    }

    console.log(chalk.blue(`Migrating from ${chalk.bold(source)}...`), "\n");

    const result = migrateFromSource(cwd, source);
    if (!result || result.schemas.length === 0) {
      console.log(chalk.yellow("Could not find schema definitions to migrate."));
      console.log(chalk.dim(`Looked for ${source} patterns in your source files.`));
      return;
    }

    console.log(
      chalk.green(`Found ${result.schemas.length} variables`),
      chalk.dim(`in ${result.sourceFile}`), "\n"
    );

    for (const schema of result.schemas) {
      const tag = schema.required
        ? chalk.red("required")
        : chalk.yellow("optional");
      const desc = schema.description ? chalk.dim(` — ${schema.description}`) : "";
      console.log(`  ${chalk.bold(schema.name)} ${chalk.dim(schema.type)} [${tag}]${desc}`);
    }

    const content = schemaToTypenvFile(result.schemas);

    if (opts.dryRun) {
      console.log(chalk.dim("\n--- dry run: would generate ---\n"));
      console.log(content);
      return;
    }

    fs.writeFileSync(outputPath, content, "utf-8");
    console.log(chalk.green(`\nGenerated ${opts.output} from ${source} schema`));
    console.log(chalk.dim(`You can now remove ${source} from your dependencies.`));
  });

// --- helpers ---

function suggestValue(schema: EnvVarSchema): string {
  switch (schema.type) {
    case "port": return "3000";
    case "boolean": return "true";
    case "number": return "0";
    case "integer": return "0";
    case "url": return "https://...";
    case "email": return "user@example.com";
    case "enum": return schema.enumValues?.[0] ?? "";
    case "string": return `<your ${schema.name.toLowerCase()}>`;
  }
}

function describeExpectedType(schema: EnvVarSchema): string {
  switch (schema.type) {
    case "port": return "integer 0-65535";
    case "boolean": return "true/false/1/0/yes/no";
    case "number": return "numeric value";
    case "integer": return "integer value";
    case "url": return "valid URL (https://...)";
    case "email": return "valid email (user@example.com)";
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
