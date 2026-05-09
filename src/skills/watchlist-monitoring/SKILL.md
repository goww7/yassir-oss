---
name: watchlist-monitoring
description: Monitors a watchlist, portfolio, or symbol set for Shariah compliance drift via trajectory + staleness insights, then surfaces filings, earnings, and material events. Use when the user asks what changed, what to monitor, which names need re-screening, or runs /monitor.
---

# Watchlist Monitoring (Predictive Compliance)

This is the canonical playbook for `/monitor`. Lead with the insights trio — that's what makes Yassir predictive instead of reactive.

## Source Order
1. `get_compliance_trajectory` and `get_screening_staleness` (parallel — drift signal)
2. `get_halal_alternatives` (only for symbols flagged or already non-compliant)
3. `get_shariah` for any symbol where current verdict is unknown or stale
4. `read_filings` or `sec_submissions` for material events the staleness check surfaces
5. `web_search` for missing context

## Workflow
1. Identify the target watchlist (resolve via `list_watchlists` / `get_watchlist`) or explicit ticker set.
2. For each symbol, call `get_compliance_trajectory` and `get_screening_staleness` in parallel. This is the drift signal — a stable trend with a fresh screen means low risk; a deteriorating trend or staleness flag means re-screen now.
3. For any symbol with deteriorating ratios, recent material filings, or NON_COMPLIANT verdict, also call `get_halal_alternatives` so the user sees substitutes alongside the warning.
4. If HalalTerminal quota is blocked, stop, direct the user to dashboard, and do not continue into filings or news.
5. If insights endpoints return `degraded_sources` (200 + note), surface the note verbatim once — don't refuse, proceed with available evidence.
6. Render a single decision-grade table: `symbol · current verdict · trajectory direction · staleness flag · top 3 alternatives if needed`.
7. End with what should be re-screened now vs what can stay on watch.

## Output Contract
- `Predictive Watch Table` (the decision-grade table above)
- `Drift & Staleness Highlights` (only the symbols that flagged)
- `Suggested Re-Screens`
- `Replacement Ideas` (per non-compliant or drifting name)
- `Backend Notes` (degraded sources, abstains, unresolved)

## Token Budget
The insights trio consumes roughly 3 endpoint calls per symbol. For watchlists or symbol sets with more than 5 names, mention the expected total token consumption upfront so the user can choose to narrow scope before running.
