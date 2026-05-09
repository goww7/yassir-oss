---
name: single-asset-shariah-review
description: Reviews one stock or ETF for Shariah compliance, methodology differences, purification implications, and investability. Use when the user asks if a ticker is halal, wants a compliance verdict, or needs a decision-ready memo on one asset.
---

# Single Asset Shariah Review

## Source Order
1. `get_shariah`
2. `get_market_data`
3. `get_financials`
4. `sec_company_facts` or `read_filings` when the reason for a verdict needs validation
5. `web_search` only for missing recent context

## Workflow
1. Resolve the ticker and asset type.
2. Run `get_shariah` first and treat its methodology output as the authoritative compliance base.
3. If HalalTerminal quota is blocked, stop the deep review there and tell the user to check the HalalTerminal dashboard, restore screening access, and rerun.
4. Do not add market or financial filler after a quota block unless the user explicitly asked for a provisional fallback read.
5. If the asset is an ETF, surface the v2 disposition (e.g. `compliant_with_purification`, `mostly_compliant`) and any scholar attestations alongside holdings, screening weight, and purification — never reduce the ETF to a binary halal/not-halal.
6. If the verdict is `COMPLIANT` with marginal ratios (debt-to-MC > 25% OR cash-and-securities > 20%), proactively call `get_compliance_trajectory` and `get_screening_staleness` once. Marginal compliance is the most useful place to surface drift.
7. If the verdict is `abstain` (ADR currency mismatch or other INSUFFICIENT_DATA), explicitly state the abstain reason and never claim a halal/non-halal verdict.
8. Add market and financial context only after the compliance picture is clear.
9. If methodologies disagree, explain the disagreement and label scholar-verified methodologies as such — do not flatten into fake certainty.
10. If the symbol is unresolved or coverage is thin, say so clearly and downgrade confidence.

## Output Contract
- `Verdict`: compliant, non-compliant, mixed-methodology, or insufficient evidence
- `Methodology Breakdown`: AAOIFI, DJIM, FTSE, MSCI, S&P when available
- `Key Reasons`: business screen, financial ratio pressure points, unresolved items
- `Purification`: available rate/guidance or clear missing-data note
- `Portfolio Fit`: what this means for a halal investor
- `Next Checks`: only 1-3 concrete follow-ups
