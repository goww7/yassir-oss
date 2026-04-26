---
name: watchlist-monitoring
description: Monitors a watchlist, portfolio, or symbol set for Shariah compliance drift, filings, earnings, and material events. Use when the user asks what changed, what to monitor, or which names need re-screening.
---

# Watchlist Monitoring

## Source Order
1. `get_shariah`
2. `get_market_data`
3. `read_filings` or `sec_submissions`
4. `web_search` for missing context

## Workflow
1. Identify the target watchlist, workspace, or explicit ticker set.
2. Check current Shariah status and note any drift, unresolved names, or methodology changes.
3. If HalalTerminal quota is blocked, stop the monitoring workflow and direct the user to check dashboard access before rerunning.
4. Do not continue into filings, earnings, or news after a quota block unless the user explicitly asked for a provisional fallback view.
5. Add earnings, filing, or material-event context only when it changes the investment interpretation.
6. Prioritize monitor-worthy items by impact: compliance drift first, then material events, then price/news noise.
7. End with what should be re-screened now vs what can simply stay on watch.

## Output Contract
- `What Changed`
- `Compliance Drift`
- `Material Events`
- `High-Priority Rechecks`
- `Watch / Hold / Remove Suggestions`
