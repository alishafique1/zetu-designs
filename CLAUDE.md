# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zetu Designs (formerly Social Dots Design Studio) is an AI-powered design artifact generator. It uses coding agents (Claude Code, Codex, Gemini, etc.) as the design engine, driven by composable Skills and brand-grade Design Systems. The system parses `<artifact>` tags streamed from agents and renders them live in a sandboxed iframe preview.

## Commands

```bash
nvm use                    # Node 20-22 (required; 24 not supported due to better-sqlite3)
corepack enable            # Enable pnpm via corepack
pnpm install              # Install dependencies

pnpm dev:all              # Dev mode: daemon (:7456) + Next.js (:3000) together
pnpm dev                  # Next.js dev server only (:3000)
pnpm daemon               # Daemon only (:7456)

pnpm build                # Production build
pnpm preview              # Build + serve static export via daemon
pnpm start                # Build + daemon (single-process prod mode)

pnpm typecheck            # TypeScript type checking (tsc -b --noEmit)
pnpm test                 # Vitest unit tests
pnpm test:run             # Vitest run (single execution)
pnpm test:ui              # Playwright e2e tests (headless)
pnpm test:ui:headed       # Playwright e2e tests (headed)
pnpm test:e2e:live        # Live runtime adapter e2e tests
```

## Architecture

```
Browser → Next.js 16 App Router → Local daemon (Express + better-sqlite3)
                                  → spawns Claude Code / Codex / Gemini / etc.
                                  → streams <artifact> tags → sandboxed iframe preview
```

### Two Execution Modes
- **Local CLI** (default): Frontend → daemon `/api/chat` → `spawn(<agent>)` → stdout → artifact parser
- **Anthropic API** (fallback/BYOK): Frontend → `@anthropic-ai/sdk` direct → artifact parser

### Key Components

| Directory | Purpose |
|---|---|
| `daemon/` | Node/Express server - agent spawning, skills loading, design-system resolution, SQLite project storage |
| `src/` | React/TypeScript client - App orchestration, components, state, providers, runtime |
| `app/` | Next.js 16 App Router entrypoints and layouts |
| `skills/` | 19 built-in skills (web-prototype, saas-landing, dashboard, etc.) |
| `design-systems/` | 71 brand-grade design systems (Linear, Stripe, Vercel, Airbnb, etc.) |
| `e2e/` | Playwright e2e tests |
| `tests/` | Vitest unit tests |

### Dev Server Proxy (next.config.ts)

During development, Next.js rewrites specific paths to the daemon port (7456):
- `/api/*` → daemon's REST API
- `/artifacts/*` → artifact files
- `/frames/*` → preview frames

In production, Next.js runs in `standalone` output mode with Clerk SSR support.

### Prompt Composition

System prompts layer three sources:
```
BASE_SYSTEM_PROMPT (artifact output contract)
  + active design system body (DESIGN.md)
  + active skill body (SKILL.md)
```

## Key Files

| File | Purpose |
|---|---|
| `daemon/server.js` | Express server with all API routes |
| `daemon/agents.js` | PATH-based agent detection and spawning |
| `daemon/skills.js` | SKILL.md loader with frontmatter parser |
| `daemon/design-systems.js` | DESIGN.md loader |
| `src/App.tsx` | Main app orchestrator with mode/skill/DS pickers |
| `src/providers/daemon.ts` | Fetch-SSE against daemon API (local CLI path) |
| `src/providers/anthropic.ts` | Direct SDK stream (BYOK path) |
| `src/artifacts/parser.ts` | Streaming `<artifact>` tag parser |
| `src/runtime/srcdoc.ts` | Sandbox wrapper for iframe srcDoc |

## Development Notes

- **No agent CLI required to develop** - daemon falls back to "Anthropic API · BYOK" when no CLI is detected
- **better-sqlite3** must be built natively - if prebuilt binaries are missing for your Node version, it falls back to native compilation
- Skills hot-reload in dev via FS watch
- Design systems hot-reload on file change
- Artifact previews use `<iframe sandbox="allow-scripts">` with no `allow-same-origin` for security
