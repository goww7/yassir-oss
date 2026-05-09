# Yassir Prompt Examples

Use these prompts in the CLI or web companion after setting `OPENAI_API_KEY`
and `HALAL_TERMINAL_API_KEY`.

## Predictive Compliance (new in 2.0)

The insights endpoints turn Yassir from a screener into a watchdog: ratio
trajectory, screening staleness, and halal alternatives all become first-class
tool calls — and the agent calls them proactively when a verdict is marginal.

### Single-symbol drift check

```text
Is AAPL drifting toward non-compliance?
```

Yassir runs `get_compliance_trajectory` and `get_screening_staleness` in
parallel, calls out any ratio trending toward a methodology threshold, and
notes whether the cached screen is older than recent material filings.

### Watchlist sweep

```text
/monitor AAPL MSFT NVDA TSLA
```

Returns a single decision-grade table:

```text
Symbol  Verdict       Trend          Stale?  Suggested replacements
AAPL    COMPLIANT     stable          no     —
MSFT    COMPLIANT     debt rising     no     —  (drift watch)
NVDA    COMPLIANT     stable          yes    re-screen recommended
TSLA    COMPLIANT     debt declining  no     —

Notes: 1 stale screening detected. Run /staleness NVDA for details.
Evidence: AAOIFI verified, FTSE verified, MSCI verified across all four.
```

### Predictive watch over a named watchlist

```text
/monitor watchlist:Halal Tech
```

Same flow, but resolves the watchlist via `list_watchlists` / `get_watchlist`
first. Yassir warns about expected token consumption upfront when the
watchlist has more than 5 symbols.

### Honest ETF verdicts

```text
Is HLAL halal? Show the methodology breakdown.
```

The response cites the v2 disposition (e.g. `compliant_with_purification`),
the count of scholar-attested methodologies, and any per-methodology
attestations — never collapsed to a binary halal/not-halal.

### Replacement flow on a non-compliant name

```text
/ideas TSLA
```

Yassir calls `get_halal_alternatives` first for ranked, compliance-aware
substitutes (sector match, market cap, methodology coverage), then validates
each candidate's current Shariah status and flags any that abstain (e.g. ADR
currency mismatch) or have non-verified methodology coverage.

## Shariah Screening

```text
Is AAPL Shariah-compliant? Show the full screening breakdown.
```

```text
Compare MSFT, NVDA, and AMD for Shariah compliance and explain the key differences.
```

```text
/screen TSLA
```

## Portfolio Review

```text
/audit AAPL MSFT SPUS
```

```text
Audit this portfolio for halal investing risks: AAPL 40%, MSFT 30%, SPUS 30%.
```

```text
Which holdings need closer Shariah review and why?
```

## Purification

```text
/purification AAPL MSFT
```

```text
Estimate dividend purification context for my Apple and Microsoft holdings.
```

## Halal Alternatives

```text
/ideas replace QQQ with halal alternatives
```

```text
Find halal-friendly alternatives to a US large-cap growth ETF.
```

```text
I want lower exposure to non-compliant revenue. Suggest replacement ideas and explain trade-offs.
```

## Filing And Company Research

```text
Summarize Tesla's latest 10-K risk factors.
```

```text
What did Apple say about services revenue and regulatory risk in recent filings?
```

```text
Pull the latest company facts for MSFT and explain the important financial signals.
```

## Market Context

```text
Give me recent market and news context for NVDA, then explain what matters for a halal investor.
```

```text
Compare AAPL and MSFT using quote data, company context, and Shariah screening evidence.
```

## Guided Workflows

```text
/guide
```

```text
Walk me through a single-asset Shariah review for AAPL.
```

```text
Help me monitor a halal investing watchlist for AAPL, MSFT, SPUS, and HLAL.
```
