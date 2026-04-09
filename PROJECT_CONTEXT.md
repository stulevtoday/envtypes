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

- **Phase**: MVP complete + framework detection + runtime API
- **npm name**: `envtypes` (available, not yet published)
- **Session**: 1 (continuing)
- **What exists**:
  - 7 source modules: cli, scanner, schema, validator, generator, frameworks, runtime
  - 52 passing tests across 5 test files
  - Build working via tsup (ESM + DTS)
  - Framework detection for 7 frameworks
  - Runtime `defineEnv` / `t` builder API
  - Comprehensive README

## Architecture

```
typenv/                          (local dir name, npm name = envtypes)
├── src/
│   ├── cli.ts                   # CLI entry point (4 commands)
│   ├── scanner.ts               # AST-based env var discovery (ts-morph)
│   ├── schema.ts                # Schema generation + .envtypes.ts output
│   ├── validator.ts             # .env validation against schema
│   ├── generator.ts             # TypeScript env module + .env.example generation
│   ├── frameworks.ts            # Framework detection + scope classification
│   ├── runtime.ts               # defineEnv / t builder API (user-facing)
│   ├── types.ts                 # Shared type definitions
│   └── index.ts                 # Public API exports
├── tests/
│   ├── scanner.test.ts
│   ├── schema.test.ts
│   ├── validator.test.ts
│   ├── frameworks.test.ts
│   ├── runtime.test.ts
│   └── fixtures/
│       ├── sample-project/      # Basic Node.js project fixture
│       └── nextjs-project/      # Next.js project fixture
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
| `envtypes check` | Validate `.env` against schema (supports --ci) |
| `envtypes generate` | Emit type-safe `env.ts` + `.env.example` |

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

- [ ] Publish to npm as 0.1.0 beta (need npm account)
- [ ] Create GitHub repository
- [ ] GitHub Action for CI (`envtypes check --ci`)
- [ ] Watch mode for development
- [ ] `.env.example` sync check (warn if stale)
- [ ] Monorepo support (scan specific packages)
- [ ] Improve scan performance (incremental mode / caching)
- [ ] Security warnings (client-exposed vars that look like secrets)
- [ ] Website / landing page

## Ideas Backlog

- Python support (`os.environ`, `os.getenv`)
- Go support (`os.Getenv`)
- Rust support (`std::env::var`)
- VS Code extension (inline warnings, autocomplete for .env)
- Web dashboard for team env management
- Diff mode: compare .env files across environments
- Secret detection: warn if values look like real credentials
- Migration from envalid/znv/t3-env

## Session Log

### Session 1 — 2026-04-09
- Chose project direction: developer tooling, env var management
- Made architectural decisions (ADR-001 through ADR-005)
- Built complete MVP: scanner, schema, validator, generator, CLI
- All 4 CLI commands working: `scan`, `init`, `check`, `generate`
- AST-based scanner: dot access, bracket access, destructuring, `import.meta.env`
- Type inference from naming conventions: ports, URLs, booleans, numbers, enums
- Default value detection from `||`, `??`, and destructuring defaults
- Framework detection: Next.js, Vite, Astro, Remix, Nuxt, CRA, Expo
- Scope classification: client-exposed vs server-only variables
- Runtime API: `defineEnv` + `t` builder with full type inference
- Generated modules include runtime validation + enum checking
- Smart `.env.example` with context-aware URL examples
- Build via tsup (ESM + DTS), 52/52 tests passing
- Renamed from typenv to envtypes (npm availability)
- Git repo initialized, 2 commits
