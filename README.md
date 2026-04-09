<p align="center">
  <br>
  <strong>E N V T Y P E S</strong>
  <br>
  <em>Your code knows what env vars it needs. Now your tooling does too.</em>
  <br>
  <br>
  <img src="https://img.shields.io/badge/runtime-Node_·_Deno_·_Bun-4ade80?style=flat-square" />
  <img src="https://img.shields.io/badge/frameworks-7-5b7fff?style=flat-square" />
  <img src="https://img.shields.io/badge/tests-98_passing-4ade80?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-888?style=flat-square" />
  <br>
  <br>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-4ade80?style=flat-square&logo=node.js&logoColor=white" />
</p>

---

You deploy to production. The app crashes. `DATABASE_URL` was missing. Someone added it three weeks ago and nobody updated `.env.production`.

**envtypes** makes this impossible. It scans your code, finds every `process.env` reference, infers types from naming conventions, catches security issues, and generates type-safe access — all automatically.

Unlike envalid, znv, or t3-env, you don't manually define schemas. **envtypes reads your codebase and figures it out.**

```
$ npx envtypes doctor

Framework: next
Scanning /app (45ms)

Found 12 variables in 8 files

Validation
  ✓ .env

Security
  ✗ CRITICAL  NEXT_PUBLIC_API_SECRET is client-exposed but contains "SECRET"
    → Move to a server-only variable without the client prefix
  ! WARNING  JWT_SECRET has a weak or placeholder default value
    → Remove the default and require explicit configuration

Sync
  ✓ .env.example is in sync

───────────────────────────────────
  1 critical issue(s)   1 warning(s)
───────────────────────────────────
```

## 30 seconds to try it

```bash
npx envtypes doctor
```

One command. No config. Instant report.

## Install

```bash
npm install -D envtypes
```

## Commands

| Command | What it does |
|---|---|
| `envtypes scan` | Find all env vars in your code |
| `envtypes check` | Validate `.env` files against your code |
| `envtypes doctor` | Full health check: validation + security + sync |
| `envtypes generate` | Emit a type-safe `env.ts` module + `.env.example` |
| `envtypes diff` | Compare two `.env` files with masked secrets |
| `envtypes compare` | Matrix view across multiple environments |
| `envtypes audit` | Full markdown/JSON report for docs & compliance |
| `envtypes watch` | Continuous validation during development |
| `envtypes migrate` | Import from envalid, znv, or t3-env |
| `envtypes hook` | Install git pre-commit validation hook |
| `envtypes init` | Generate `.envtypes.ts` schema from scan |

Every command that outputs text supports `--json` for CI pipelines.

---

## Runtime API

Type-safe env access with full TypeScript inference:

```ts
import { defineEnv, t } from "envtypes";

const env = defineEnv({
  PORT:          t.port().default("3000"),
  DATABASE_URL:  t.url().description("Primary database"),
  NODE_ENV:      t.enum(["development", "production", "test"]),
  DEBUG:         t.boolean().optional(),
  WORKERS:       t.integer().default("4"),
  ADMIN_EMAIL:   t.email(),
  FEATURE_FLAGS: t.json<{ dark: boolean }>().optional(),
  BUILD_TAG:     t.regex(/^v\d+\.\d+\.\d+$/, "semver").optional(),
});

env.PORT          // number
env.NODE_ENV      // "development" | "production" | "test"
env.FEATURE_FLAGS // { dark: boolean } | undefined
```

Fails fast on startup with all errors at once:

```
Error: Environment validation failed:
  - DATABASE_URL: Expected valid URL, got "not-a-url"
  - ADMIN_EMAIL: Expected email address, got "nope"
```

### Available types

| Builder | Parses to | Validates |
|---|---|---|
| `t.string()` | `string` | any value |
| `t.number()` | `number` | numeric |
| `t.integer()` | `number` | whole numbers |
| `t.boolean()` | `boolean` | true/false/1/0/yes/no |
| `t.port()` | `number` | 0-65535 |
| `t.url()` | `string` | valid URL |
| `t.email()` | `string` | valid email |
| `t.enum([...])` | union type | exact match |
| `t.json<T>()` | `T` | valid JSON |
| `t.regex(re)` | `string` | pattern match |

All types support `.optional()`, `.default("value")`, and `.description("text")`.

---

## How it works

### AST scanning

envtypes uses [ts-morph](https://ts-morph.com) to parse your source files and find every env var reference:

```ts
process.env.PORT                    // dot access
process.env["API_KEY"]              // bracket access
const { REDIS_URL } = process.env   // destructuring
import.meta.env.VITE_API_URL        // Vite / Astro
Deno.env.get("DATABASE_URL")        // Deno
Bun.env.SECRET_KEY                  // Bun
```

Default values are detected from `||`, `??`, destructuring defaults, and ternary expressions.

### Type inference

| Pattern | Inferred type |
|---|---|
| `*_PORT` | port (0-65535) |
| `*_URL`, `*_URI` | URL |
| `*_EMAIL`, `SMTP_FROM` | email |
| `DEBUG`, `ENABLE_*`, `IS_*`, `USE_*` | boolean |
| `*_COUNT`, `*_SIZE`, `*_TIMEOUT` | number |
| `NODE_ENV` | enum |
| everything else | string |

### Framework detection

Automatically identifies your framework and classifies variables as client-exposed or server-only:

| Framework | Client prefix | Detection |
|---|---|---|
| Next.js | `NEXT_PUBLIC_` | `next` in deps |
| Vite | `VITE_` | `vite` in deps |
| Astro | `PUBLIC_` | `astro` in deps |
| Nuxt | `NUXT_PUBLIC_` | `nuxt` in deps |
| CRA | `REACT_APP_` | `react-scripts` in deps |
| Expo | `EXPO_PUBLIC_` | `expo` in deps |
| Remix | _(none)_ | `@remix-run/*` in deps |

---

## Security analysis

envtypes catches real mistakes:

- **Client-exposed secrets** — `NEXT_PUBLIC_API_SECRET` will be visible in the browser
- **Leaked connection strings** — `VITE_DATABASE_URL` exposes credentials to the client
- **Weak defaults** — `JWT_SECRET` defaults to `"changeme"`
- **Known credentials** — `AWS_SECRET_ACCESS_KEY`, `STRIPE_SECRET_KEY`, etc.
- **Missing gitignore** — `.env` files not covered by `.gitignore`

---

## Cross-environment comparison

See which variables are present or missing across environments at a glance:

```
$ envtypes compare .env .env.staging .env.production

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

---

## .env parser

Production-grade parser included:

```env
# Standard
PORT=3000

# With export prefix
export DATABASE_URL=postgres://localhost/db

# Multiline (double quotes)
RSA_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
-----END RSA PRIVATE KEY-----"

# Escape sequences
MSG="line 1\nline 2\ttabbed"

# Variable interpolation
DB_HOST=localhost
DB_PORT=5432
DATABASE_URL=postgres://${DB_HOST}:${DB_PORT}/mydb

# Inline comments
TIMEOUT=5000 # milliseconds
```

---

## Migration

Coming from another tool? One command:

```bash
npx envtypes migrate              # auto-detects envalid, znv, or t3-env
npx envtypes migrate --dry-run    # preview first
```

---

## CI Integration

### GitHub Actions (direct)

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

### Pre-commit hook

```bash
npx envtypes hook install
```

Blocks commits when env issues are found. Remove with `npx envtypes hook uninstall`.

---

## Configuration

Optional. Create `.envtypes.json` or add `"envtypes"` to `package.json`:

```json
{
  "include": ["src/**/*.ts", "lib/**/*.ts"],
  "exclude": ["**/*.test.*"],
  "output": "src/env.ts",
  "ignore": ["LEGACY_VAR"],
  "overrides": {
    "CUSTOM_PORT": { "type": "port" },
    "LOG_LEVEL": { "type": "enum", "enumValues": ["debug", "info", "warn", "error"] }
  }
}
```

## Programmatic API

```ts
import { scan, generateSchema, validate, parseEnvFile, detectFrameworks, analyzeSecurityIssues, defineEnv, t } from "envtypes";
```

---

## License

MIT
