---
name: purification-analysis
description: Analyzes dividend purification for one or more holdings and explains what is known, missing, or method-dependent. Use for purification amount questions, dividend cleansing, or income-quality reviews.
---

# Purification Analysis

## Source Order
1. `get_shariah`
2. `get_market_data`
3. `get_financials`
4. `web_search` only if backend guidance is incomplete and additional public explanation is needed

## Workflow
1. Start with backend purification and dividend-related data.
2. Separate known purification figures from estimated or unavailable figures.
3. Explain whether the figure is a backend calculation, a cached result, or only a general guide.
4. If the user supplied dividend income, tie the answer back to the supplied amounts.
5. If no purification rate is available, say exactly what is missing instead of guessing.

## Output Contract
- `Purification Summary`
- `Known Rates / Amounts`
- `Missing Or Uncertain Inputs`
- `Implication For Portfolio Income`
- `Next Step`: what the user should verify or re-run
