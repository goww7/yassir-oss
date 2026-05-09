---
name: portfolio-compliance-audit
description: Runs a full Shariah portfolio audit across multiple stocks and ETFs. Use for portfolio screening, compliance concentration review, unresolved names, and action-oriented portfolio summaries.
---

# Portfolio Compliance Audit

## Source Order
1. `get_shariah`
2. `get_market_data`
3. `get_financials`
4. `sec_company_facts` for follow-up validation on risky holdings
5. `web_search` only for missing current catalysts or material events

## Workflow
1. Normalize the holdings list and identify stocks vs ETFs.
2. Run the portfolio-level Shariah workflow first.
3. If HalalTerminal quota is blocked, stop the audit there, mark the portfolio as unresolved, and send the user to the HalalTerminal dashboard to check account access before rerunning.
4. Do not spend tokens on market-data, financials, or news after a quota block unless the user explicitly asked for a provisional fallback view.
5. Separate holdings into compliant, non-compliant, mixed, abstaining (INSUFFICIENT_DATA), and unresolved buckets — abstain is evidence absence, not a compliance signal.
6. For each ETF holding, render its v2 disposition and attestation count rather than collapsing to pass/fail.
7. After the scan, for any COMPLIANT holding with marginal ratios (debt-to-MC > 25% OR cash-and-securities > 20%), call `get_compliance_trajectory` and `get_screening_staleness` once and report the drift signal alongside the verdict.
8. Flag concentration risk when the same weak methodology pattern appears repeatedly.
9. Call out unresolved and abstaining names as portfolio risk, not as acceptable certainty.
10. If a holding fails, prepare replacement ideas via `get_halal_alternatives` but keep them secondary unless the user asked for substitutes.

## Output Contract
- `Portfolio Verdict`: concise top-line read
- `Compliant Holdings`
- `At Risk Holdings`
- `Unresolved Holdings`
- `Purification Notes`
- `Concentration / Construction Risks`
- `Recommended Actions`: remove, re-screen, monitor, or replace
- If quota-blocked, make the first recommendation `check HalalTerminal account access, then rerun the audit`
