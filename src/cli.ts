import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { scan } from "./scanner.js";
import { generateSchema, schemaToTypenvFile } from "./schema.js";
import { validate, parseEnvFile, findEnvFiles } from "./validator.js";
import { generateEnvModule, generateEnvExample } from "./generator.js";
import { detectFrameworks, classifyVariable } from "./frameworks.js";
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

    console.log(chalk.blue("Scanning codebase for env var usage..."), "\n");
    const result = scan({ cwd });

    if (result.variables.length === 0) {
      console.log(chalk.yellow("No environment variables found in code."));
      return;
    }

    const schemas = generateSchema(result.variables);

    const envFiles = opts.env
      ? [path.resolve(cwd, opts.env)]
      : findEnvFiles(cwd);

    if (envFiles.length === 0) {
      console.log(chalk.yellow("No .env files found."));
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
          console.log(chalk.red(`  ✗ ${name} — missing (required)`));
        }
      }

      if (validationResult.typeErrors.length > 0) {
        hasErrors = true;
        const typeErrs = validationResult.errors.filter(
          (e) => e.severity === "error" && !validationResult.missing.includes(e.variable)
        );
        for (const err of typeErrs) {
          console.log(chalk.red(`  ✗ ${err.message}`));
        }
      }

      if (validationResult.extra.length > 0) {
        for (const name of validationResult.extra) {
          console.log(chalk.yellow(`  ? ${name} — not referenced in code`));
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
  .option("-o, --output <path>", "Output module path", "src/env.ts")
  .option("--example", "Also generate .env.example", true)
  .action((opts) => {
    const cwd = path.resolve(opts.dir);

    console.log(chalk.blue("Scanning codebase..."), "\n");
    const result = scan({ cwd });

    if (result.variables.length === 0) {
      console.log(chalk.yellow("No environment variables found."));
      return;
    }

    const schemas = generateSchema(result.variables);

    const modulePath = path.resolve(cwd, opts.output);
    const moduleDir = path.dirname(modulePath);
    if (!fs.existsSync(moduleDir)) {
      fs.mkdirSync(moduleDir, { recursive: true });
    }

    const moduleContent = generateEnvModule(schemas);
    fs.writeFileSync(modulePath, moduleContent, "utf-8");
    console.log(chalk.green(`Generated ${opts.output}`));

    if (opts.example) {
      const examplePath = path.resolve(cwd, ".env.example");
      const exampleContent = generateEnvExample(schemas);
      fs.writeFileSync(examplePath, exampleContent, "utf-8");
      console.log(chalk.green("Generated .env.example"));
    }

    console.log(
      chalk.dim(`\nUsage: import { env } from "${opts.output.replace(/\.ts$/, ".js")}";`)
    );
    console.log(chalk.dim("Then access: env.DATABASE_URL, env.PORT, etc."));
  });

// --- helpers ---

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
