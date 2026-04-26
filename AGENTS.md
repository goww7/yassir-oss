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
