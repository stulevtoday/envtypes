# typenv — Project Context

> This document maintains continuity across development sessions.
> Pass it at the start of each session to restore full project context.

## Vision

**typenv** is a CLI tool that makes environment variables type-safe and self-documenting.

Unlike existing solutions (envalid, znv, t3-env) that require manual schema definition, typenv **scans your codebase** to discover all environment variable usage, then generates schemas, types, and validation automatically.

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
- **Decision**: Use TypeScript — `.typenv.ts` file with a builder API
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

## Current State

- **Phase**: Initial build — MVP
- **Session**: 1
- **What exists**: Project scaffolding, core modules in development

## Architecture

```
typenv/
├── src/
│   ├── cli.ts            # CLI entry point and command definitions
│   ├── scanner.ts         # AST-based env var discovery
│   ├── schema.ts          # Schema types and generation
│   ├── validator.ts       # .env validation against schema
│   ├── generator.ts       # TypeScript type/module generation
│   └── utils.ts           # Shared utilities
├── tests/
│   ├── scanner.test.ts
│   ├── validator.test.ts
│   └── fixtures/          # Test project fixtures
├── PROJECT_CONTEXT.md     # This file
├── package.json
├── tsconfig.json
└── README.md
```

### Core Flow

```
Codebase → [Scanner] → EnvVarUsage[] → [Schema Generator] → .typenv.ts
.env + .typenv.ts → [Validator] → ValidationResult
.typenv.ts → [Type Generator] → env.d.ts + env.ts (type-safe access module)
```

### CLI Commands (MVP)

| Command | Description |
|---------|-------------|
| `typenv scan` | Discover env vars in codebase, show report |
| `typenv init` | Generate `.typenv.ts` schema from scan |
| `typenv check` | Validate `.env` against schema |
| `typenv generate` | Emit type-safe `env.ts` access module |

## Next Steps

- [ ] Complete scanner with support for `process.env.X`, `process.env['X']`, destructuring
- [ ] Schema generation with inferred types (PORT → number, DEBUG → boolean, etc.)
- [ ] Validator with clear error messages
- [ ] Type generator for runtime-validated, typed env access
- [ ] Tests for all core modules
- [ ] README with usage examples

## Ideas Backlog

- Framework detection (Next.js `NEXT_PUBLIC_`, Vite `VITE_`, etc.)
- `.env.example` generation
- GitHub Action for CI validation
- Watch mode for development
- Monorepo support (scan specific packages)
- Python support (`os.environ`, `os.getenv`)
- Go support (`os.Getenv`)
- VS Code extension (inline warnings for missing vars)
- Web dashboard for team env management

## Session Log

### Session 1 — 2026-04-09
- Chose project direction: developer tooling, env var management
- Made architectural decisions (ADR-001 through ADR-004)
- Building MVP: scanner, schema, validator, generator, CLI
