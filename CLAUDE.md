# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context
Meeting Prep Tool — an internal tool that indexes podcast transcripts and youtube transcripts (ie conferences panels, interviews) and generates AI-powered meeting prep for conversations with external prospects. Initial use case is for AI-data platform selling into investment funds.


Full PRD: docs/prd.md
Current phase: Phase 1 — Transcript Viewer + Lookup UI
Milestone (1C): Type "Apollo" → instant results. Click bullet → transcript viewer at correct section with search pre-loaded.
Milestone (1D): Paste a YouTube URL (conference panel or interview) → transcript scraped, cleaned with speaker attribution, synthetic sections generated, entities extracted, bullets generated. Verify: turns[].timestamp_seconds populated, citation link opens YouTube at correct moment.

Tech stack: Next.js 16 app using the App Router with TypeScript, React 19, and Tailwind CSS v4.

Source lives in `src/app/` with the `@/*` path alias mapped to `./src/*`.
Styling uses Tailwind CSS v4 (imported via `@import "tailwindcss"` in `globals.css`)
with Geist fonts configured as CSS variables.

Backend: Supabase (Postgres) for storage, full-text search (tsvector), and JSONB
entity/bullet storage. Claude API (Anthropic SDK) for transcript processing pipeline.
Deployed on Vercel.

## Context files — read these before starting any task
- CLAUDE.md
- docs/prd.md — full product requirements
- docs/implementation-plan.md — current build plan by phase

## Protected files
- Never use the Write tool on `docs/implementation-plan.md` — always use Edit with targeted replacements.

## Architecture rules
- All LLM processing happens at INGESTION time, never at query time.
  Lookup is pure database retrieval — instant, deterministic, no waiting for Claude.
- Raw transcripts are never overwritten. Always store raw alongside cleaned.
- Entity tags and prep bullets stored as JSONB in Postgres.
- Full-text search via tsvector generated column on cleaned_transcript.
- Prompts live in lib/prompts/ as exported strings — never inline in pipeline functions.

## File structure
lib/          — scrapers, pipeline, prompts, db, queue, api (server-side logic)
src/app/      — Next.js pages and API routes
docs/         — prd.md, implementation-plan.md

## Commands

- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — Run ESLint (flat config, `eslint.config.mjs`)
- `npx vitest` — Run unit/integration tests
- `npx tsx lib/scrapers/colossus.ts` — Test scraper manually (once built)

## Testing
- Use Vitest for unit/integration tests. Co-locate test files next to source.
- Focus tests on:
  - Pipeline output shapes (does extractEntities return valid JSON matching the schema?)
  - Supabase query correctness (does fund name search hit entity_tags JSONB?)
  - Scraper metadata extraction (title, date, guest names parsed correctly)
- Don't bother testing yet:
  - Scraper DOM selectors (Colossus HTML will change; these tests go stale fast)
  - Exact LLM output text (non-deterministic — test structure, not content)
- Playwright for E2E tests once Phase 1 UI exists. Not before.

## Observability

All pipeline functions must have console.log bookends:
- `[step] starting, transcript length: X chars` — before the API call
- `[step] complete, X output/chars` — after

Long-running steps (clean.ts) should also log chunk progress every 5 seconds via setInterval so you can confirm the connection is alive during processing. Silence for >30 seconds with no chunk logs = something is wrong.

Never strip these logs to "clean up" — they are the primary debugging signal for pipeline issues.

## Data trust tiers
Three-tier provenance model used across the pipeline for any field where data quality varies by extraction method:
- `"source"` — directly from original content (HTML scraping, human-edited labels, structured API data). No UI indicator needed.
- `"derived"` — mechanically extracted from source data (regex parsing, timestamp matching, text splitting). Subtle UI indicator.
- `"inferred"` — LLM-generated or best-guess (speaker attribution, synthetic sections, entity extraction). Visible UI indicator + hover disclaimer.

Apply consistently. When adding a new field with quality hierarchy, use this union type rather than inventing per-feature terminology. Current usages:
- `Turn.attribution`: `"source" | "inferred"` (retrofit to include `"derived"` when relevant)
- `SectionHeading.source`: `"source" | "derived" | "inferred"` (planned)

## Before Committing
- Run `npm run typecheck && npm test && npm run test:e2e && npm run build`
- Scan all changed files for:
  - Missing try-catch around async operations
  - Missing error/loading states in UI components
  - Unvalidated inputs (URL params, form fields, pagination)
  - Dead code or unused exports
  - Edge cases (empty arrays, NaN, null)
- When fixing a bug, check for similar issues elsewhere in the same file
- Batch related fixes and their tests in one commit (reduces BugBot round-trips)
- Verify no API keys, tokens, or secrets in committed code (use .env.local)
- Verify Supabase queries use parameterized inputs (no string interpolation)
- Verify pipeline functions have console.log bookends
- Self-audit against session prompt: If this session was driven by a session prompt (.md file):
1. Compare every task in the prompt against what was built. For each task, confirm it was done with specific evidence (function name, file, line) or flag what's missing/different.
2. List any assumptions you made that weren't explicit in the prompt — places where two reasonable implementations were possible and you picked one. Explain why you chose what you chose.
3. List anything from the prompt you intentionally skipped or interpreted differently, and why.
Do not commit until all tasks are accounted for.

## Communication style
When correcting a mistake or changing approach, briefly explain *why* (e.g., "one branch per PR because...") so I learn the underlying principle, not just the fix.

## Code Style
- TypeScript strict mode
- Functional components with hooks
- Use named exports

## Git Workflow
- Never commit to main
- Always pull latest main before creating a new branch.
- Always create a NEW branch for each change (never reuse old names)
- Write clear commit messages
- Open a PR for every change, even small ones
- Don't push new commits while BugBot is mid-review (wait for it to finish or you'll restart the review)


## Environment variables
Required in .env.local:
  NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL (NEXT_PUBLIC_ exposes to browser)
  NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anonymous key (NEXT_PUBLIC_ exposes to browser)
  SUPABASE_SERVICE_KEY          — Supabase service role key (server-side pipeline only)
  ANTHROPIC_API_KEY             — Claude API key
  GOOGLE_AUTH_TOKEN             — For Colossus scraper (TBD — may be cookie or OAuth token)
  ADMIN_TOKEN                   — Auth header for /api/process/* routes (prevents open LLM proxy)

  