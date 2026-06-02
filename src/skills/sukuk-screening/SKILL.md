---
name: sukuk-screening
description: Search, look up, and assess sukuk (Islamic fixed income / "halal bonds") by issuer, country, structure, currency, ISIN, or issuer LEI. Use for sukuk discovery, building a sukuk shortlist, or checking a single sukuk instrument's structure and compliance basis.
---

# Sukuk Screening

## Source Order
1. `get_shariah` (routes to `search_sukuk` / `get_sukuk` / `get_sukuk_issuer`)
2. `web_search` only if the backend lacks an instrument and public context is genuinely needed

## Workflow
1. **Discovery** ("find sukuk in Saudi Arabia", "ijara sukuk in USD", "sukuk from issuer X") → `search_sukuk` with the relevant facets (issuer, country, structure, currency, maturity window). Don't invent a free-text query; map the request to the available facets.
2. **Single instrument** → `get_sukuk` with its ISIN.
3. **Issuer programme** → `get_sukuk_issuer` with the issuer's LEI.
4. Report what the backend returns: structure (ijara / murabaha / wakala / mudaraba / …), issuer, currency, maturity, profit rate, and the compliance / documentation basis.
5. State clearly when a field is unavailable instead of guessing.

## Honesty contract
Sukuk compliance is **structure- and documentation-dependent**. Surface the basis the backend reports; **do not issue a fatwa or a blanket halal/haram verdict** on a sukuk. If the backend has no compliance signal for an instrument, say so.

## Output Contract
- `Matches` (search) or `Instrument` (single ISIN)
- `Structure & Issuer`
- `Key Terms` (currency, maturity, profit rate)
- `Compliance Basis` (what the backend reports; note if structure-dependent)
- `Missing Or Uncertain`
- `Next Step`
