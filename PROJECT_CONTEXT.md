# envtypes — Project Context

> This document maintains continuity across development sessions.
> Pass it at the start of each session to restore full project context.

## Vision

**envtypes** is a CLI tool + runtime library that makes environment variables type-safe and self-documenting.

Unlike existing solutions (envalid, znv, t3-env) that require manual schema definition, envtypes **scans your codebase** to discover all environment variable usage, then generates schemas, types, and validation automatically.

The end goal: no Node.js/TypeScript project should ever crash at runtime because of a missing or malformed env var.

### Revenue Path

1. **Phase 1** — Open-source CLI tool. Build community, get adoption.
2. **Phase 2** — CI/CD integration (GitHub Action). Free for public repos.
3. **Phase 3** — Hosted service: team-shared schemas, env drift alerts, audit log. $10-30/mo.
4. **Phase 4** — Enterprise: SSO, compliance reporting, self-hosted option.

## Decisions Log

### ADR-001: Language and Runtime — TypeScript on Node.js
- **Status**: Accepted
- **Context**: Need to parse JS/TS code, target the JS ecosystem first
- **Decision**: TypeScript with ts-morph for AST analysis, tsup for bundling
- **Consequences**: Limited to JS/TS ecosystem initially; can add Python/Go scanners later

### ADR-002: Schema Format — TypeScript DSL
- **Status**: Accepted
- **Context**: Schema could be YAML, JSON, or TypeScript
- **Decision**: Use TypeScript — `.envtypes.ts` file with `defineEnv` + `t` builder API
- **Consequences**: Devs get autocomplete and type checking in the schema itself; harder for non-TS projects (mitigated: JSON fallback planned)

### ADR-003: CLI Framework — Commander.js
- **Status**: Accepted
- **Context**: Needed lightweight, stable CLI framework
- **Decision**: Commander.js — battle-tested, minimal dependencies
- **Consequences**: Simple, proven, no magic

### ADR-004: Testing — Vitest
- **Status**: Accepted
- **Context**: Need fast tests with good TS support
- **Decision**: Vitest — fast, native TS, compatible API
- **Consequences**: Modern, fast feedback loop

### ADR-005: Package Name — envtypes
- **Status**: Accepted
- **Context**: `typenv` was taken on npm
- **Decision**: Renamed to `envtypes` — descriptive, available, easy to type
- **Consequences**: All internal references updated; CLI command is `envtypes`

## Current State

- **Phase**: Feature-complete — pushed to GitHub, ready for npm publish
- **GitHub**: https://github.com/stulevtoday/envtypes
- **npm name**: `envtypes` (available, not yet published)
- **Session**: 3
- **What exists**:
  - 15 source modules: cli, scanner, schema, validator, generator, frameworks, runtime, security, sync, config, watcher, audit, migrate, types, index
  - 98 passing tests across 8 test files
  - Build working via tsup (ESM + DTS)
  - 11 CLI commands: scan, init, check, generate, doctor, audit, diff, compare, watch, migrate, hook
  - Framework detection for 7 frameworks
  - Runtime `defineEnv` / `t` builder API
  - Security analysis (client-exposed secrets, weak defaults, gitignore coverage)
  - `.env.example` sync checker
  - Config file support (`.envtypes.json` / package.json field)
  - Multi-runtime: Node.js, Deno, Bun, Vite/Astro
  - Watch mode for continuous development validation
  - Markdown + JSON audit report generator
  - Env diff with automatic secret masking
  - Env compare — multi-environment matrix view
  - JSON output for check, doctor, and audit (CI-friendly)
  - GitHub Action ready (action.yml)
  - CI workflow (.github/workflows/ci.yml) — tests on Node 18/20/22
  - Ternary default detection in scanner
  - import.meta.env bracket access support
  - Production-grade .env parser (multiline, interpolation, export prefix, escapes)
  - Runtime types: t.email(), t.json(), t.integer(), t.regex(), .description()
  - Schema migration from envalid, znv, t3-env
  - Git pre-commit hook (envtypes hook install/uninstall)
  - JSDoc comments in generated env.ts from schema descriptions
  - Dynamic .env file discovery (*.local, custom names)
  - Comprehensive README with all features documented

## Architecture

```
typenv/                          (local dir name, npm name = envtypes)
├── src/
│   ├── cli.ts                   # CLI entry point (8 commands)
│   ├── scanner.ts               # AST-based env var discovery (ts-morph)
│   ├── schema.ts                # Schema generation + .envtypes.ts output
│   ├── validator.ts             # .env validation against schema
│   ├── generator.ts             # TypeScript env module + .env.example generation
│   ├── frameworks.ts            # Framework detection + scope classification
│   ├── security.ts              # Security analysis (client secrets, weak defaults)
│   ├── sync.ts                  # .env.example sync checker
│   ├── config.ts                # Config file loading (.envtypes.json)
│   ├── watcher.ts               # File watcher for continuous validation
│   ├── audit.ts                 # Markdown audit report generator
│   ├── runtime.ts               # defineEnv / t builder API (user-facing)
│   ├── types.ts                 # Shared type definitions
│   └── index.ts                 # Public API exports
├── tests/
│   ├── scanner.test.ts
│   ├── scanner-extended.test.ts # Deno/Bun runtime tests
│   ├── schema.test.ts
│   ├── validator.test.ts
│   ├── frameworks.test.ts
│   ├── runtime.test.ts
│   ├── security.test.ts
│   ├── config.test.ts
│   └── fixtures/
│       ├── sample-project/      # Basic Node.js project fixture
│       ├── nextjs-project/      # Next.js project fixture
│       ├── nextjs-security/     # Security issue test fixture
│       └── multi-runtime/       # Deno + Bun fixture
├── PROJECT_CONTEXT.md           # This file
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

### Core Flow

```
Codebase → [Scanner] → EnvVarUsage[] → [Schema Generator] → .envtypes.ts
.env + schema → [Validator] → ValidationResult
schema → [Generator] → env.ts (type-safe access) + .env.example
Framework → [Detector] → scope classification (client/server)
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `envtypes scan` | Discover env vars, show report with framework scope |
| `envtypes init` | Generate `.envtypes.ts` schema from scan |
| `envtypes check` | Validate `.env` against schema (--ci, --json) |
| `envtypes generate` | Emit type-safe `env.ts` + `.env.example` |
| `envtypes doctor` | Run all checks: validation + security + sync (--ci, --json) |
| `envtypes audit` | Full markdown/JSON report for docs/compliance |
| `envtypes compare` | Multi-environment matrix comparison |
| `envtypes migrate` | Import schema from envalid/znv/t3-env |
| `envtypes hook` | Install/uninstall git pre-commit hook |
| `envtypes diff` | Compare .env files with auto-masked secrets |
| `envtypes watch` | Continuous validation on file changes |

### Runtime API

```ts
import { defineEnv, t } from "envtypes";

export default defineEnv({
  PORT: t.port().default("3000"),
  DATABASE_URL: t.url(),
  NODE_ENV: t.enum(["development", "production", "test"]),
  DEBUG: t.boolean().optional(),
});
```

### Programmatic API

```ts
import { scan, generateSchema, validate, parseEnvFile } from "envtypes";
```

## Next Steps

- [ ] Publish to npm as 0.1.0
- [ ] Monorepo support (scan specific packages, workspace-aware)
- [ ] Incremental scan mode (cache results, only re-scan changed files)
- [ ] Website / landing page
- [ ] VS Code extension (inline diagnostics for .env files)
- [ ] `envtypes validate` — validate a .envtypes.ts schema file itself
- [ ] YAML output option for audit
- [ ] Husky integration guide

## Ideas Backlog

- Python support (`os.environ`, `os.getenv`)
- Go support (`os.Getenv`)
- Rust support (`std::env::var`)
- VS Code extension (inline warnings, autocomplete for .env)
- Web dashboard for team env management
- Secret detection: warn if actual values look like real credentials (entropy check)
- Migration from envalid/znv/t3-env
- TOML config support (`.envtypes.toml`)
- Turbopack / Webpack env plugin integration

## Session Log

### Session 1 — 2026-04-09
- Chose project direction: developer tooling, env var management
- Made architectural decisions (ADR-001 through ADR-005)
- Built complete MVP: scanner, schema, validator, generator, CLI
- All 5 CLI commands: `scan`, `init`, `check`, `generate`, `doctor`
- AST-based scanner: dot access, bracket access, destructuring, `import.meta.env`
- Multi-runtime support: Node.js `process.env`, Deno `Deno.env.get()`, Bun `Bun.env`
- Type inference from naming conventions: ports, URLs, booleans, numbers, enums
- Default value detection from `||`, `??`, and destructuring defaults
- Framework detection: Next.js, Vite, Astro, Remix, Nuxt, CRA, Expo
- Scope classification: client-exposed vs server-only variables
- Security analysis: client-exposed secrets, weak defaults, connection string leaks
- `.env.example` sync checker
- Config file support: `.envtypes.json` and package.json `envtypes` field
- Schema overrides and ignore lists
- Runtime API: `defineEnv` + `t` builder with full type inference
- Generated modules include runtime validation + enum checking
- Smart `.env.example` with context-aware URL examples
- Actionable error messages: suggest values, expected types, fix instructions
- Build via tsup (ESM + DTS), 75/75 tests passing across 8 test files
- Renamed from typenv to envtypes (npm availability)
- Git repo initialized, ready for publish
- Added: GitHub Action (action.yml + example workflow)
- Added: watch mode — continuous validation on file changes
- Added: audit command — full markdown report with usage map
- Added: diff command — compare .env files, auto-mask secrets
- Updated README with complete feature documentation
- Build: 75 tests pass, tsup ESM+DTS builds clean, 4 commits

### Session 2 — 2026-04-10
- Pushed codebase to GitHub (git@github.com:stulevtoday/envtypes.git)
- Implemented `.gitignore` security check — warns if `.env` files aren't gitignored
- Added `--json` flag to `check`, `doctor`, and `audit` commands for CI integration
- Added `envtypes compare` command — multi-environment matrix view
- Hardened scanner: ternary default detection (`x ? x : 'default'`)
- Added `import.meta.env["VAR"]` bracket access support
- Added CI workflow (`.github/workflows/ci.yml`) — Node 18/20/22 matrix
- Fixed `action.yml` author and example workflow org references
- Added 4 new tests (gitignore security, ternary defaults)
- Updated README and PROJECT_CONTEXT with all new features
- Build: 79 tests pass, tsup ESM+DTS builds clean, types check clean

### Session 3 — 2026-04-10
- Rewrote .env parser: multiline values, variable interpolation (${VAR}), export prefix, escape sequences, inline comments
- Added runtime types: t.email(), t.json(), t.integer(), t.regex(), .description()
- Added `envtypes migrate` command: auto-detect and import from envalid, znv, t3-env
- Added `envtypes hook install/uninstall`: git pre-commit hook for envtypes doctor
- Generated env.ts now includes JSDoc comments from schema descriptions
- Dynamic .env file discovery: .env.*.local, custom filenames
- Added email and integer type inference, validation, and generation
- 19 new tests (enhanced parser, new runtime types, email/integer validation)
- Build: 98 tests pass, tsup ESM+DTS builds clean, types check clean
