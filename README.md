# envtypes

Type-safe environment variables for TypeScript projects.

**envtypes** scans your codebase, finds every environment variable reference, and generates typed schemas, validation, and a type-safe access module — automatically.

## Why envtypes?

Existing tools (envalid, znv, t3-env) require you to manually define schemas. **envtypes reads your code** — it discovers what you actually use, infers types from naming conventions, detects frameworks, and catches security issues.

```bash
npx envtypes doctor
```

```
Framework: next
Scanning /path/to/project

Found 12 variables in 8 files (45ms)

Validation
  ✓ .env

Security
  ✗ CRITICAL NEXT_PUBLIC_API_SECRET is client-exposed but contains "SECRET"
    → Move the secret to a server-only variable without the client prefix
  ! WARNING JWT_SECRET has a weak or placeholder default value
    → Remove the default and require explicit configuration

Sync
  ✓ .env.example is in sync

───────────────────────────────────
  1 critical issue(s)   1 warning(s)
───────────────────────────────────
```

## Quick Start

```bash
npm install -D envtypes

npx envtypes scan         # Find all env vars in your code
npx envtypes check        # Validate your .env files
npx envtypes doctor       # Run all checks at once
npx envtypes generate     # Emit a typed env module + .env.example
```

## Features

- **AST scanning** — Finds `process.env`, `import.meta.env`, `Deno.env.get()`, `Bun.env` references
- **Type inference** — `*_PORT` → port, `*_URL` → URL, `DEBUG` → boolean, `NODE_ENV` → enum
- **Framework detection** — Next.js, Vite, Astro, Remix, Nuxt, CRA, Expo
- **Scope analysis** — Classifies vars as client-exposed or server-only
- **Security analysis** — Catches leaked secrets, weak defaults, exposed DB connections
- **Config file** — `.envtypes.json` for project-specific settings
- **Watch mode** — Continuous validation during development
- **Audit reports** — Full markdown or JSON report for docs and compliance
- **Env diff** — Compare `.env` files across environments with auto-masked secrets
- **Env compare** — Cross-environment matrix view of all variables
- **JSON output** — Machine-readable output for `check`, `doctor`, and `audit` (`--json`)
- **Gitignore check** — Warns if `.env` files are not gitignored
- **Migration** — Import schemas from envalid, znv, or t3-env (`envtypes migrate`)
- **Pre-commit hook** — `envtypes hook install` blocks commits with env issues
- **Enhanced .env parser** — Multiline values, `${VAR}` interpolation, `export` prefix, escape sequences

## Commands

### `envtypes scan`

Discover all environment variables in your project.

```bash
envtypes scan                  # Scan current directory
envtypes scan --dir ./backend  # Scan specific directory
envtypes scan --json           # Output as JSON
```

### `envtypes check`

Validate `.env` files against your codebase with actionable error messages.

```bash
envtypes check                    # Check all .env files
envtypes check --env .env.prod    # Check specific file
envtypes check --ci               # Exit code 1 on errors
envtypes check --json             # Machine-readable JSON output
```

When errors are found, envtypes suggests fixes:

```
.env.production
  ✗ DATABASE_URL — missing (required)
    add: DATABASE_URL=https://...
  ✗ PORT should be a valid port (0-65535), got "not-a-number"
    expected: integer 0-65535
  ? LEGACY_FLAG — defined but not referenced in code
    safe to remove, or add to "ignore" in .envtypes.json
```

### `envtypes doctor`

Run all checks in one pass: validation, security, and `.env.example` sync.

```bash
envtypes doctor          # Full health check
envtypes doctor --ci     # Fail on critical issues
envtypes doctor --json   # Structured JSON for CI pipelines
```

### `envtypes generate`

Generate a type-safe env access module and `.env.example`.

```bash
envtypes generate                        # Default: src/env.ts
envtypes generate --output lib/config.ts # Custom path
envtypes generate --no-example           # Skip .env.example
```

### `envtypes diff`

Compare `.env` files across environments. Sensitive values are automatically masked.

```bash
envtypes diff .env .env.staging
```

```
Comparing .env ↔ .env.staging

Only in .env:
  - LOCAL_SETTING

Different values:
  API_KEY
    .env: sk*********yz
    .env.staging: sk*********ab
  DATABASE_URL
    .env: postgres://localhost:5432/db
    .env.staging: postgres://staging.example.com/db
  NODE_ENV
    .env: development
    .env.staging: staging

1 identical · 3 different · 1 only in .env · 0 only in .env.staging
```

### `envtypes compare`

Show a matrix of environment variables across multiple `.env` files — see which vars are present or missing in each environment at a glance.

```bash
envtypes compare .env .env.staging .env.production
envtypes compare .env .env.staging --json
```

```
Variable            .env         .env.staging .env.production
──────────────────────────────────────────────────────────────
API_KEY             sk****yz     sk****ab     sk****cd
DATABASE_URL        postgres://… postgres://… postgres://…
DEBUG               true         ✗            ✗
NODE_ENV            development  staging      production
PORT                3000         3000         8080
──────────────────────────────────────────────────────────────
Coverage: .env: 5/5 (100%)  ·  .env.staging: 4/5 (80%)  ·  .env.production: 4/5 (80%)
```

### `envtypes audit`

Generate a comprehensive markdown report of all environment variables — useful for documentation, onboarding, and compliance.

```bash
envtypes audit                     # Print to stdout
envtypes audit -o ENV_AUDIT.md     # Write to file
envtypes audit --json              # Structured JSON output
envtypes audit --json -o audit.json
```

### `envtypes watch`

Continuously watch for changes and validate in real-time.

```bash
envtypes watch
```

```
Watching /path/to/project (Ctrl+C to stop)

[14:23:01] 12 variables · all good (45ms)
[14:23:15] File changed, re-scanning...
[14:23:15] 13 variables · 1 error(s) (38ms)
```

### `envtypes init`

Generate a schema file from scanning your codebase.

```bash
envtypes init              # Generates .envtypes.ts
envtypes init --force      # Overwrite existing
```

### `envtypes migrate`

Import env schema from envalid, znv, or t3-env — automatically converts to envtypes format.

```bash
envtypes migrate                    # Auto-detect source
envtypes migrate --source envalid   # Force source
envtypes migrate --dry-run          # Preview without writing
```

### `envtypes hook`

Install a git pre-commit hook that runs `envtypes doctor --ci` before each commit.

```bash
envtypes hook install      # Add pre-commit hook
envtypes hook uninstall    # Remove it
```

## Runtime API

Use `defineEnv` and `t` builders for runtime validation with full TypeScript inference:

```ts
import { defineEnv, t } from "envtypes";

const env = defineEnv({
  PORT: t.port().default("3000"),
  DATABASE_URL: t.url().description("Primary database connection"),
  NODE_ENV: t.enum(["development", "production", "test"]),
  DEBUG: t.boolean().optional(),
  API_KEY: t.string(),
  WORKERS: t.integer().default("4"),
  ADMIN_EMAIL: t.email(),
  FEATURE_FLAGS: t.json<{ darkMode: boolean }>().optional(),
  BUILD_TAG: t.regex(/^v\d+\.\d+\.\d+$/, "semver tag").optional(),
});

// env.PORT          → number
// env.DEBUG         → boolean | undefined
// env.NODE_ENV      → "development" | "production" | "test"
// env.FEATURE_FLAGS → { darkMode: boolean } | undefined
```

Throws on startup with all errors at once:

```
Error: Environment validation failed:
  - DATABASE_URL: Expected valid URL, got "not-a-url"
  - API_KEY: Required but not provided
```

## Type Inference

| Pattern | Inferred Type | Examples |
|---------|--------------|---------|
| `*_PORT` | port (0-65535) | `PORT`, `DB_PORT` |
| `*_URL`, `*_URI` | URL | `DATABASE_URL`, `REDIS_URL` |
| `*_EMAIL`, `SMTP_FROM`, `REPLY_TO` | email | `ADMIN_EMAIL`, `MAIL_FROM` |
| `DEBUG`, `ENABLE_*`, `IS_*`, `USE_*` | boolean | `DEBUG`, `ENABLE_CACHE` |
| `*_COUNT`, `*_SIZE`, `*_TIMEOUT`, `*_TTL` | number | `MAX_RETRIES`, `CACHE_TTL` |
| `NODE_ENV` | enum | `development`, `production`, `test` |
| Everything else | string | `API_KEY`, `SECRET_TOKEN` |

## Framework Detection

Automatically detects your framework and classifies variables by scope:

| Framework | Client Prefix | Detection |
|-----------|---------------|-----------|
| Next.js | `NEXT_PUBLIC_` | `next` in deps |
| Vite | `VITE_` | `vite` in deps |
| Astro | `PUBLIC_` | `astro` in deps |
| Nuxt | `NUXT_PUBLIC_` | `nuxt` in deps |
| CRA | `REACT_APP_` | `react-scripts` in deps |
| Expo | `EXPO_PUBLIC_` | `expo` in deps |
| Remix | — | `@remix-run/*` in deps |

## Security Analysis

envtypes catches common security mistakes:

- **Client-exposed secrets** — `NEXT_PUBLIC_API_SECRET` contains "SECRET" but is browser-visible
- **Leaked connection strings** — `VITE_DATABASE_URL` exposes database credentials to the client
- **Weak defaults** — `JWT_SECRET` defaults to `"changeme"` or short placeholder values
- **Known credential patterns** — Detects `AWS_SECRET_ACCESS_KEY`, `STRIPE_SECRET_KEY`, etc.
- **Gitignore coverage** — Warns if `.env` files are not listed in `.gitignore`

## Configuration

Create `.envtypes.json` in your project root, or add an `envtypes` field to `package.json`:

```json
{
  "include": ["src/**/*.ts", "lib/**/*.ts"],
  "exclude": ["**/*.test.*"],
  "output": "src/env.ts",
  "ignore": ["LEGACY_VAR", "DEPRECATED_FLAG"],
  "overrides": {
    "CUSTOM_PORT": { "type": "port" },
    "LOG_LEVEL": {
      "type": "enum",
      "enumValues": ["debug", "info", "warn", "error"]
    }
  }
}
```

## CI Integration

### Direct

```yaml
- name: Validate environment
  run: npx envtypes doctor --ci
```

### GitHub Action

```yaml
- uses: stulevtoday/envtypes@v1
  with:
    command: doctor
```

## .env Parsing

envtypes includes a production-grade `.env` parser:

- **`export` prefix** — `export PORT=3000` works
- **Multiline values** — Double-quoted values can span lines
- **Escape sequences** — `\n`, `\t`, `\\`, `\"` in double-quoted values
- **Single quotes** — Literal values, no escaping
- **Variable interpolation** — `DATABASE_URL=postgres://${DB_HOST}:${DB_PORT}/${DB_NAME}`
- **Inline comments** — `PORT=3000 # web server port`

## Programmatic API

```ts
import {
  scan,
  generateSchema,
  validate,
  parseEnvFile,
  detectFrameworks,
  analyzeSecurityIssues,
  defineEnv,
  t,
} from "envtypes";
```

## Supported Runtimes

- **Node.js** — `process.env.VAR`, `process.env['VAR']`, `const { VAR } = process.env`
- **Deno** — `Deno.env.get("VAR")`
- **Bun** — `Bun.env.VAR`, `Bun.env['VAR']`, `const { VAR } = Bun.env`
- **Vite/Astro** — `import.meta.env.VAR`

## License

MIT
