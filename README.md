# Social Dots Design Studio

> **AI-powered design artifact generator.** Local-first, web-deployable, BYOK at every layer — your existing coding agent (Claude Code, Codex, Cursor Agent, Gemini CLI, OpenCode, Qwen, GitHub Copilot CLI) becomes the design engine, driven by **19 composable Skills** and **71 brand-grade Design Systems**.

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
  <a href="#supported-coding-agents"><img alt="Agents" src="https://img.shields.io/badge/agents-Claude%20%7C%20Codex%20%7C%20Cursor%20%7C%20Gemini%20%7C%20OpenCode%20%7C%20Qwen%20%7C%20Copilot-black" /></a>
  <a href="#design-systems"><img alt="Design systems" src="https://img.shields.io/badge/design%20systems-71-orange" /></a>
  <a href="#skills"><img alt="Skills" src="https://img.shields.io/badge/skills-19-teal" /></a>
  <a href="QUICKSTART.md"><img alt="Quickstart" src="https://img.shields.io/badge/quickstart-3%20commands-green" /></a>
</p>

<p align="center"><b>By Social Dots</b> · Powered by <a href="https://github.com/nexu-io/open-design">nexu-io/open-design</a></p>

---

## What it is

Social Dots Design Studio is a rebranded deployment of [Open Design](https://github.com/nexu-io/open-design) — the open-source alternative to Claude Design. It gives you:

- **19 ready-to-use Skills** — web prototypes, SaaS landing pages, dashboards, mobile apps, pitch decks, blog posts, pricing pages, docs, and more
- **71 brand-grade Design Systems** — Linear, Stripe, Vercel, Airbnb, Notion, Apple, Figma, and more, each as a portable `DESIGN.md` file
- **Live artifact preview** — every `<artifact>` tag renders in a sandboxed iframe in real time
- **5 visual direction presets** — when you have no brand, pick from curated OKLch palettes + font stacks
- **Local daemon + Next.js frontend** — runs on `pnpm dev` locally, deploys to Vercel

## Quickstart

```bash
git clone https://github.com/alishafique1/social-dots-design-studio.git
cd social-dots-design-studio
nvm use              # Node 22 from .nvmrc
corepack enable
pnpm install
pnpm dev:all         # daemon (:7456) + Next dev (:3000)
open http://localhost:3000
```

On first load the app detects your installed coding agent CLI, picks a default skill + design system, and you're ready to type a prompt.

## Architecture

```
Browser → Next.js 16 App Router → Local daemon (Express + SQLite)
                                  → spawns Claude Code / Codex / Gemini / etc.
                                  → streams <artifact> tags → sandboxed iframe preview
```

For **Vercel deployment**, the daemon runs as a serverless-compatible process. See `QUICKSTART.md` for the full deploy guide.

## Skills (19 built-in)

**Prototype surfaces:** `web-prototype` · `saas-landing` · `dashboard` · `pricing-page` · `docs-page` · `blog-post` · `mobile-app`

**Deck / PPT:** `simple-deck` · `guizang-ppt` (magazine-style)

**Documents:** `pm-spec` · `weekly-update` · `meeting-notes` · `eng-runbook` · `finance-report` · `hr-onboarding` · `invoice` · `kanban-board` · `team-okrs`

## Design Systems (71 built-in)

Linear · Stripe · Vercel · Airbnb · Tesla · Notion · Anthropic · Apple · Cursor · Supabase · Figma · Resend · Raycast · Cohere · Mistral · ElevenLabs · X.AI · Spotify · Webflow · Sanity · PostHog · Sentry · MongoDB · ClickHouse · and more.

## Connect to Hermes

Social Dots Design Studio can be wired into Hermes as a skill or triggered via API. The daemon exposes REST endpoints (`/api/chat`, `/api/skills`, `/api/design-systems`) that Hermes can call to generate branded design artifacts on demand.

## License

Apache-2.0 · Based on [nexu-io/open-design](https://github.com/nexu-io/open-design)
