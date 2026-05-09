# Changelog

All notable changes to Yassir are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with date-based
versioning aligned to the release tag (`vYYYY.M.D`).

## [2026.5.9] — Predictive Compliance

Don't just screen. Catch compliance drift before it hits your portfolio.

### Added

- **Trajectory, staleness, and replacements.** Yassir now tracks the
  direction of a name's compliance ratios over time, flags when a cached
  screen is too old to trust, and proposes halal replacements for any
  holding that fails or starts drifting. The agent calls these checks
  proactively — you don't have to ask.
- **`/monitor <SYMS>` and `/monitor watchlist:<name>`.** One command
  watches a set of names for compliance drift, stale screens, and
  replacement candidates. Output is a single decision-grade table:
  `verdict · trend · stale? · suggested replacements`.
- **`/trajectory <SYM>`** — quick drift check on a single name.
- **`/staleness <SYM>`** — is the cached screen still trustworthy?
  Reports screen age and any material SEC filings since.
- **Predictive-compliance walkthrough** in `docs/examples.md` — four
  worked prompts covering single-symbol drift, watchlist sweep, ETF
  disposition, and the replacement flow on a non-compliant holding.
- **Key management for self-hosters.** Track usage, daily burn, and
  projected quota exhaustion at your current rate. Rotate or revoke API
  keys without leaving the agent.

### Changed

- **ETFs render with v2 nuance when the backend provides it.** When
  the screening response carries the v2 disposition
  (`compliant_with_purification`, `mostly_compliant`, or
  `non_compliant`) and scholar attestations, Yassir surfaces them
  instead of collapsing to a boolean. ETFs still on the legacy v1
  shape render normally.
- **Stock verdicts label confidence.** Scholar-verified methodologies
  are tagged `verified`; algorithmic-only methodologies are called out
  as such only when you ask for a methodology breakdown.
- **`/audit`** automatically follows up on COMPLIANT names with marginal
  ratios — you'll see a drift watch on positions that pass today but
  are trending the wrong way.
- **`/ideas <SYM>`** prefers Halal Terminal's compliance-ranked
  alternatives, so a single-symbol "what can I replace this with"
  returns curated substitutes rather than free-text search.
- **`/usage`** now reports your 14-day burn, recent calls, and projected
  exhaustion at the current rate — not just remaining quota.

### Fixed

- **No more confident verdicts on insufficient data.** When a company's
  financials report in a different currency than the listing (common in
  ADRs), market-cap-based methodologies now abstain with
  `INSUFFICIENT_DATA` instead of forcing a wrong answer. Asset-based
  methodologies continue to render normally.
- **Stale screens are surfaced, not silently consumed.** Yassir flags
  the cache age and recommends a refresh before any high-stakes
  decision.
- **Degraded upstreams stay honest.** When part of a check is
  unavailable (for example, a temporary EDGAR outage), Yassir surfaces
  the limitation once at the top of the answer instead of hiding it.

### Reliability

- Automatic retries on rate-limit (429) responses before any tool-level
  error.
- Evidence-quality discipline baked into the agent: every answer is
  labeled *verified*, *algorithmic-only*, *abstained*, or *partial*
  before any verdict claim. "No data" never blurs into "non-compliant".

## [2026.4.26] — Initial public release

First public release of Yassir. Open-source AI research agent for halal
finance and Shariah-compliant investing.

[2026.5.9]: https://github.com/goww7/yassir-oss/releases/tag/v2026.5.9
[2026.4.26]: https://github.com/goww7/yassir-oss/releases/tag/v2026.4.26
