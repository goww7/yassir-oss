---
name: halal-replacement-ideas
description: Suggests halal-compliant replacements for a failing holding, theme, or benchmark exposure. Use when the user wants alternatives, substitutions, or fresh Shariah-compliant ideas.
---

# Halal Replacement Ideas

## Source Order
1. `get_shariah`
2. `search_halal_database` through the Shariah workflow
3. `get_market_data`
4. `get_financials`
5. `web_search` only to fill missing context

## Workflow
1. Identify what exposure the user wants to keep: sector, geography, style, ETF-like exposure, or quality bias.
2. Confirm why the original holding is problematic.
3. If the reason the original holding is problematic depends on a live Shariah screen and HalalTerminal quota is blocked, pause and ask the user to restore screening access before treating the replacement workflow as authoritative.
4. Generate replacement candidates that preserve the intended exposure as closely as possible.
5. Check each candidate’s Shariah status before discussing valuation or momentum.
6. Avoid overconfident “best idea” language when candidate coverage is thin or methodology splits exist.

## Output Contract
- `Original Exposure`
- `Why Replacement Is Needed`
- `Replacement Candidates`
- `Compliance Notes`
- `Trade-Offs`
- `Best Fit By Use Case`
