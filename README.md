# envtypes

Type-safe environment variables for TypeScript projects.

**envtypes** scans your codebase, finds every `process.env` reference, and generates typed schemas, validation, and a type-safe access module — automatically.

## The Problem

```ts
const port = Number(process.env.PORT);
const dbUrl = process.env.DATABASE_URL; // string | undefined — good luck

// Then in production:
// TypeError: Cannot read properties of undefined
// Because someone forgot to set DATABASE_URL
```

Every project has environment variables scattered across files with no validation, no types, and no documentation. New developers ask "which env vars do I need?" and nobody has a definitive answer.

## The Solution

```bash
npx envtypes scan        # Find all env vars in your code
npx envtypes check       # Validate your .env files
npx envtypes generate    # Emit a type-safe env module
```

**envtypes** reads your code (not your config), discovers every environment variable reference, infers types from naming conventions, and generates everything you need.

## Quick Start

```bash
npm install -D envtypes

# See what env vars your project uses
npx envtypes scan

# Validate your .env against what code actually needs
npx envtypes check

# Generate a typed env module + .env.example
npx envtypes generate
```

## What It Generates

Given a codebase that uses `process.env.PORT`, `process.env.DATABASE_URL`, `process.env.NODE_ENV`, and `process.env.DEBUG`:

### Type-safe access module (`env.ts`)

```ts
export interface Env {
  DATABASE_URL: string;
  NODE_ENV: "development" | "production" | "test" | "staging";
  DEBUG?: boolean;
  PORT?: number;
}

function loadEnv(): Env {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.NODE_ENV) missing.push("NODE_ENV");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    NODE_ENV: process.env.NODE_ENV!,
    DEBUG: process.env.DEBUG
      ? ["true", "1", "yes"].includes(process.env.DEBUG.toLowerCase())
      : undefined,
    PORT: Number(process.env.PORT ?? "3000"),
  };
}

export const env = loadEnv();
```

### Runtime schema (`.envtypes.ts`)

Or define your schema explicitly for full control:

```ts
import { defineEnv, t } from "envtypes";

export default defineEnv({
  DATABASE_URL: t.url(),
  NODE_ENV: t.enum(["development", "production", "test"]),
  PORT: t.port().default("3000"),
  DEBUG: t.boolean().optional(),
  API_KEY: t.string(),
});
```

### `.env.example`

```bash
# Required
DATABASE_URL=postgres://user:password@localhost:5432/dbname
NODE_ENV=development
API_KEY=your_api_key

# Optional
# DEBUG=true
# PORT=3000 (default: 3000)
```

## How It Works

1. **Scans** your code using AST analysis — finds `process.env.X`, `process.env['X']`, `const { X } = process.env`, and `import.meta.env.X`
2. **Infers types** from naming conventions — `*_PORT` → number, `*_URL` → URL validation, `DEBUG` → boolean, `NODE_ENV` → enum
3. **Detects defaults** from `||` and `??` operators and destructuring defaults
4. **Detects frameworks** — Next.js, Vite, Astro, Remix, Nuxt, CRA, Expo — and classifies vars as client-exposed or server-only
5. **Validates** your `.env` files against what your code actually uses
6. **Generates** a type-safe module that fails fast on startup if required vars are missing

## Framework Detection

envtypes automatically detects your framework and classifies variables:

```
$ npx envtypes scan
Framework: next
Scanning /path/to/project

Found 5 unique variables in 3 files (45ms)

Required:
  NEXT_PUBLIC_API_URL [client]
    src/lib/api.ts:3
  DATABASE_URL [server]
    src/lib/db.ts:1
  SECRET_KEY [server]
    src/lib/auth.ts:5

Scope analysis:
  Client-exposed (1): NEXT_PUBLIC_API_URL
  Server-only (2): DATABASE_URL, SECRET_KEY
```

Supported frameworks: Next.js, Vite, Astro, Remix, Nuxt, Create React App, Expo.

## CLI Commands

### `envtypes scan`

Discover all environment variables in your project.

```bash
envtypes scan                  # Scan current directory
envtypes scan --dir ./backend  # Scan specific directory
envtypes scan --json           # Output as JSON
```

### `envtypes check`

Validate `.env` files against your codebase.

```bash
envtypes check                    # Check all .env files
envtypes check --env .env.prod    # Check specific file
envtypes check --ci               # Exit code 1 on errors (for CI)
```

### `envtypes generate`

Generate type-safe env access module and `.env.example`.

```bash
envtypes generate                        # Default: generates src/env.ts
envtypes generate --output lib/config.ts # Custom output path
```

### `envtypes init`

Generate a schema file from scanning your codebase.

```bash
envtypes init              # Generates .envtypes.ts
envtypes init --force      # Overwrite existing
```

## Type Inference

envtypes infers types from variable names:

| Pattern | Inferred Type | Examples |
|---------|--------------|---------|
| `*_PORT` | port (0-65535) | `PORT`, `DB_PORT` |
| `*_URL`, `*_URI` | URL | `DATABASE_URL`, `API_URL` |
| `DEBUG`, `ENABLE_*`, `IS_*`, `USE_*` | boolean | `DEBUG`, `ENABLE_CACHE` |
| `*_COUNT`, `*_SIZE`, `*_TIMEOUT`, `*_TTL` | number | `MAX_RETRIES`, `CACHE_TTL` |
| `NODE_ENV` | enum | `development`, `production`, `test` |
| Everything else | string | `API_KEY`, `SECRET_TOKEN` |

## Programmatic API

```ts
import { scan, generateSchema, validate, parseEnvFile } from "envtypes";

const result = scan({ cwd: "/path/to/project" });
const schemas = generateSchema(result.variables);
const envValues = parseEnvFile("/path/to/.env");
const validation = validate(schemas, envValues);

if (!validation.valid) {
  console.error("Missing:", validation.missing);
  console.error("Type errors:", validation.typeErrors);
}
```

## CI Integration

Add to your CI pipeline to catch missing env vars before deployment:

```yaml
# GitHub Actions
- name: Validate environment
  run: npx envtypes check --ci
```

## License

MIT
