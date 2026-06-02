---
name: zakat-calculation
description: Calculate zakat owed on a stock/ETF portfolio (the obligatory ~2.5% alms) from market values against the nisab threshold. Use for "calculate my zakat", "how much zakat do I owe on my holdings", or zakat on a specific set of positions.
---

# Zakat Calculation

## Source Order
1. `get_shariah` (routes to `calculate_zakat`; resolve prices via `get_market_data` when only shares are given)

## Workflow
1. Collect holdings as `{ symbol, market_value }`. If the user gives **shares** rather than a value, fetch the current price first and compute `market_value = shares × price`.
2. Call `calculate_zakat` with the holdings (and `gold_price_per_gram` if the user supplies one; otherwise the backend uses its own nisab basis).
3. Report the zakatable base, the nisab threshold used, whether the portfolio is above nisab, and the zakat due (~2.5%).
4. If a holding's value can't be resolved, list it as **excluded** rather than guessing.

## Honesty contract
Zakat treatment of equities varies by scholarly opinion (e.g. zakat on full market value vs on zakatable assets only). Report the method the backend uses; **do not present one ruling as the only valid one. Not a fatwa.**

## Output Contract
- `Zakatable Base`
- `Nisab Threshold` (and gold price used)
- `Above Nisab?`
- `Zakat Due (~2.5%)`
- `Excluded / Unresolved`
- `Next Step`
