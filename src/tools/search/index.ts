/**
 * Rich description for the web_search tool.
 * Used in the system prompt to guide the LLM on when and how to use this tool.
 */
export const WEB_SEARCH_DESCRIPTION = `
Search the web for current information on any topic. Returns relevant search results with URLs and content snippets.

## When to Use

- Historical stock prices for equities (use get_market_data)
- Factual questions about entities (companies, people, organizations) where status can change
- Current events, breaking news, recent developments
- Technology updates, product announcements, industry trends
- Verifying claims about real-world state (public/private, active/defunct, current leadership)
- Research on topics outside of structured financial data
- Supplementing profile-specific public-data tools when you need broader context, commentary, or additional corroboration

## When NOT to Use

- Structured financial data (company financials, SEC filings, analyst estimates, key ratios - use get_financials instead)
- Profile-specific primary-source questions that are better served first by open-data tools like SEC, CourtListener, ClinicalTrials, PubMed, openFDA, USAspending, GDELT, or World Bank tools
- Pure conceptual/definitional questions ("What is a DCF?")

## Usage Notes

- Provide specific, well-formed search queries for best results
- Uses routed provider selection and strict per-query budgets to reduce failure amplification
- Tries multiple healthy providers at runtime and degrades gracefully when one fails
- Diversifies across domains and expands a small number of top pages for richer context
- Best used after or alongside the profile's structured/open-data tools, not as the first step for primary-source lookups
- Returns up to 12 results with URLs and richer snippets when available
- Use for supplementary research when get_financials doesn't cover the topic
`.trim();

export { tavilySearch } from './tavily.js';
export { braveSearch } from './brave.js';
export { exaSearch } from './exa.js';
export { perplexitySearch } from './perplexity.js';
export { federatedWebSearch } from './federated.js';
export { xSearchTool, X_SEARCH_DESCRIPTION } from './x-search.js';
