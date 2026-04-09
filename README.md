# typenv

Type-safe environment variables for TypeScript projects.

**typenv** scans your codebase, finds every `process.env` reference, and generates typed schemas, validation, and a type-safe access module — automatically.

## The Problem

```ts
// You write this everywhere:
const port = Number(process.env.PORT);
const dbUrl = process.env.DATABASE_URL; // string | undefined — good luck

// Then in production:
// TypeError: Cannot read properties of undefined
// Because someone forgot to set DATABASE_URL
```

Every project has environment variables scattered across files with no validation, no types, and no documentation. New developers ask "which env vars do I need?" and nobody has a definitive answer.

## The Solution

```bash
npx typenv scan        # Find all env vars in your code
npx typenv check       # Validate your .env files
npx typenv generate    # Emit a type-safe env module
```

**typenv** reads your code (not your config), discovers every environment variable reference, infers types from naming conventions, and generates everything you need.

## Quick Start

```bash
npm install -D typenv

# See what env vars your project uses
npx typenv scan

# Validate your .env against what code actually needs
npx typenv check

# Generate a typed env module + .env.example
npx typenv generate
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
    DEBUG: process.env.DEBUG ? ["true", "1", "yes"].includes(process.env.DEBUG.toLowerCase()) : undefined,
    PORT: Number(process.env.PORT ?? "3000"),
  };
}

export const env = loadEnv();
```

### `.env.example`

```bash
# Required
DATABASE_URL=https://example.com
NODE_ENV=development

# Optional
# DEBUG=true (default: false)
# PORT=3000 (default: 3000)
```

## How It Works

1. **Scans** your code using AST analysis (ts-morph) — finds `process.env.X`, `process.env['X']`, `const { X } = process.env`, and `import.meta.env.X`
2. **Infers types** from naming conventions — `*_PORT` → number, `*_URL` → URL validation, `DEBUG` → boolean, `NODE_ENV` → enum
3. **Detects defaults** from `||` and `??` operators and destructuring defaults
4. **Validates** your `.env` files against what your code actually uses
5. **Generates** a type-safe module that fails fast on startup if required vars are missing

## CLI Commands

### `typenv scan`

Discover all environment variables in your project.

```bash
typenv scan                  # Scan current directory
typenv scan --dir ./backend  # Scan specific directory
typenv scan --json           # Output as JSON
```

### `typenv check`

Validate `.env` files against your codebase.

```bash
typenv check                    # Check all .env files
typenv check --env .env.prod    # Check specific file
typenv check --ci               # Exit code 1 on errors (for CI)
```

### `typenv generate`

Generate type-safe env access module and `.env.example`.

```bash
typenv generate                        # Default: generates src/env.ts
typenv generate --output lib/config.ts # Custom output path
```

## Type Inference

typenv infers types from variable names:

| Pattern | Inferred Type | Examples |
|---------|--------------|---------|
| `*_PORT` | port (0-65535) | `PORT`, `DB_PORT` |
| `*_URL`, `*_URI` | URL | `DATABASE_URL`, `API_URL` |
| `DEBUG`, `ENABLE_*`, `IS_*`, `USE_*` | boolean | `DEBUG`, `ENABLE_CACHE` |
| `*_COUNT`, `*_SIZE`, `*_TIMEOUT`, `*_TTL` | number | `MAX_RETRIES`, `CACHE_TTL` |
| `NODE_ENV` | enum | `development`, `production`, `test` |
| Everything else | string | `API_KEY`, `SECRET_TOKEN` |

## CI Integration

Add to your CI pipeline to catch missing env vars before deployment:

```yaml
# GitHub Actions
- name: Validate environment
  run: npx typenv check --ci
```

## License

MIT
