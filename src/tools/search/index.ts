/**
 * Rich description for the web_search tool.
 * Used in the system prompt to guide the LLM on when and how to use this tool.
 */
export const WEB_SEARCH_DESCRIPTION = `
Search the web for current information on any topic.

By default this uses the current model's built-in search through Sub2API (OpenAI/Grok/Claude web_search, Gemini google_search) and returns a sourced synthesis. If native search is unavailable or fails, it falls back to independent engines (Exa → Perplexity → Tavily → LangSearch) which return titles, URLs, and snippets.

## When to Use

- Historical stock prices for equities (use get_market_data)
- Factual questions about entities (companies, people, organizations) where status can change
- Current events, breaking news, recent developments
- Technology updates, product announcements, industry trends
- Verifying claims about real-world state (public/private, active/defunct, current leadership)
- Research on topics outside of structured financial data

## When NOT to Use

- Structured financial data (company financials, SEC filings, key ratios - use get_financials instead)
- Pure conceptual/definitional questions ("What is a DCF?")

## Usage Notes

- Provide specific, well-formed search queries for best results
- source="auto" (default): native model search first, then independent engines
- source="independent": skip native search; use Exa/Perplexity/Tavily/LangSearch (link lists)
- source="native": current-model search only; do not fall back
- After independent results, use web_fetch when you need the full page
`.trim();

export { tavilySearch } from './tavily.js';
export { exaSearch } from './exa.js';
export { perplexitySearch } from './perplexity.js';
export { langSearch } from './langsearch.js';
export { xSearchTool, X_SEARCH_DESCRIPTION } from './x-search.js';
