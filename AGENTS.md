# AGENTS.md

Guidance for AI coding agents working in this repository.

## Product Context

Yassir is an open-source AI research agent for halal finance and
Shariah-compliant investing. The project is the agent/application layer.
HalalTerminal is the primary data and screening layer.

Preserve these boundaries:

- Keep Yassir open-source and self-hostable.
- Keep HalalTerminal attribution visible in README, NOTICE, and UI links.
- Do not hardcode API keys or commit `.env` files.
- Do not present fallback or partial data as an authoritative Shariah verdict.

## Stack

- Runtime: Bun
- Language: TypeScript
- CLI UI: `@mariozechner/pi-tui`
- Agent/tooling: LangChain
- API server: Hono
- Web companion: React + Vite
- Validation: Zod

## Key Paths

- `src/agent/`: ReAct loop, planning, prompts, scratchpad, progress synthesis
- `src/tools/finance/`: finance, market, filings, and Shariah tools
- `src/integrations/halalterminal/`: HalalTerminal API client and types
- `src/tools/open-data/`: SEC EDGAR open-data tools
- `src/tools/fetch/`: web fetch/search support
- `src/web/`: Hono backend routes
- `web/`: React frontend
- `src/skills/`: workflow-specific agent skills

## Development Commands

```bash
bun install
bun run typecheck
bun test
```

For web UI changes:

```bash
bun run web:install
bun run web:build
```

## Implementation Rules

- Follow existing TypeScript and Zod patterns.
- Prefer extending existing tools over creating duplicate pathways.
- Keep finance/Shariah data routed through HalalTerminal-backed tools when possible.
- Use SEC/open-data and web search as supporting evidence, not as a replacement for Shariah screening.
- Treat quota-blocked HalalTerminal screening as an action-required state, not as a reason to invent a verdict.
- Keep user-facing errors plain and actionable.
- Avoid broad refactors unless the task explicitly requires them.

## Evidence Quality Discipline

When working on response rendering, summarizers, or agent prompts, preserve
these properties — they are what keeps Yassir honest when HalalTerminal is
degraded, partial, or abstaining:

- **Verification labeling.** When citing a methodology verdict, label
  scholar-verified methodologies (`verification_summary` names them) as
  "verified". Mark unverified methodologies as "algorithmic-only" only when
  the user asked for a methodology breakdown.
- **Abstain handling.** A result with `app_compliance_status="abstain"` (e.g.
  ADR financial-currency mismatch → `INSUFFICIENT_DATA`) must surface
  `abstain_reason`. Never paper over an abstain with a confident
  halal/non-halal claim.
- **Degraded sources.** When a result has `degraded_sources` (insights
  endpoints return 200 + a note when SEC EDGAR or another upstream is
  flaky), surface the note verbatim once at the top of the answer. Don't
  refuse — proceed with available evidence.
- **Staleness → force_refresh.** When `get_screening_staleness` reports
  `staleness=true`, recommend a `force_refresh` re-screen before any
  high-stakes decision rather than treating the cached verdict as current.
- **No data ≠ non-compliant.** Unresolved symbols, quota blocks, abstains,
  and degraded responses are evidence absence, not compliance signals.
  Distinguish them in summary language.
- **ETFs aren't booleans.** ETF screening returns `disposition` and
  `methodology_attestations`, not a pass/fail verdict. Cite disposition
  explicitly. Show the count of scholar-verified methodologies. Never
  reduce ETF results to a boolean halal/not-halal.

There is a regression test at `src/agent/evidence-quality.test.ts` that
asserts the corresponding bullets exist in `src/agent/prompts.ts`. Update
both together if you change the wording.

## Adding a new HalalTerminal endpoint tool

Canonical pattern, mirroring `src/tools/finance/shariah.ts`:

1. Define a Zod input schema (use `symbolSchema`, `symbolsSchema` when
   applicable).
2. Wrap the endpoint with `createTool(name, description, schema, handler)`.
   The handler returns `halalGet(...)` or `halalPost(...)` — both already
   route responses through `normalizeHalalData`.
3. Export the new tool from `src/tools/finance/shariah.ts`.
4. Import it in `src/tools/finance/get-shariah.ts` and add it to the
   `SHARIAH_TOOLS` array.
5. Add a few-shot example in the router prompt (`buildRouterPrompt`) under
   the closest section, with one or two natural-language → tool-call lines.
6. If the new tool changes a workflow, update the relevant `SKILL.md` under
   `src/skills/` and any related slash command in `cli-slash-commands.ts`.
7. Add a small test in `src/tools/finance/get-shariah.test.ts` for the
   planner gating (mutation-only tools must be filtered when the query is
   not explicitly mutating).

## Security Rules

- Never commit `.env`, API keys, local memory, `.agents`, `.yassir`, or generated dependency folders.
- Keep upload/download paths contained inside the intended workspace.
- Keep `web_fetch` protected from localhost, private networks, and cloud metadata endpoints.
- Do not log API keys. Dashboard login links should pass sensitive tokens through URL fragments, not query strings.

## Useful User Workflows

- Shariah check: `Is AAPL Shariah-compliant? Show the full screening breakdown.`
- Portfolio audit: `/audit AAPL MSFT SPUS`
- Purification: `/purification AAPL MSFT`
- Replacement ideas: `/ideas replace QQQ with halal alternatives`
- Filing research: `Summarize Tesla's latest 10-K risk factors.`

See `docs/examples.md` for more prompts.
