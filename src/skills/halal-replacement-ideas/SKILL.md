---
name: halal-replacement-ideas
description: Suggests halal-compliant replacements for a failing holding, theme, or benchmark exposure. Use when the user wants alternatives, substitutions, or fresh Shariah-compliant ideas.
---

# Halal Replacement Ideas

## Source Order
1. `get_halal_alternatives` (when the user names a single symbol — backend's ranked, compliance-aware substitutes)
2. `search_halal_database` for theme/sector queries
3. `get_shariah` to verify any candidate's current status
4. `get_market_data`
5. `get_financials`
6. `web_search` only to fill missing context

## Workflow
1. Identify what exposure the user wants to keep: sector, geography, style, ETF-like exposure, or quality bias.
2. If input is a single symbol, call `get_halal_alternatives` first — the backend ranks substitutes by sector match, market cap, and methodology coverage. Otherwise route to `search_halal_database`.
3. Confirm why the original holding is problematic (failed verdict, drifting ratios, abstain).
4. If the reason depends on a live Shariah screen and HalalTerminal quota is blocked, pause and ask the user to restore screening access before treating the replacement workflow as authoritative.
5. Generate replacement candidates that preserve the intended exposure as closely as possible.
6. Check each candidate's Shariah status — flag any that abstain (e.g. ADR currency mismatch) or have non-verified methodology coverage rather than overstating fit.
7. Avoid overconfident "best idea" language when candidate coverage is thin or methodology splits exist.

## Output Contract
- `Original Exposure`
- `Why Replacement Is Needed`
- `Replacement Candidates`
- `Compliance Notes`
- `Trade-Offs`
- `Best Fit By Use Case`
