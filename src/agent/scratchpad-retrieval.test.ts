import { describe, test, expect } from 'bun:test';
import { ScratchpadRetriever } from './scratchpad-retrieval.js';
import type { ScratchpadEntry } from './scratchpad.js';

describe('ScratchpadRetriever', () => {
  test('starts with zero summaries', () => {
    const retriever = new ScratchpadRetriever();
    expect(retriever.summaryCount).toBe(0);
  });

  test('retrieveRelevant returns empty when no summaries indexed', () => {
    const retriever = new ScratchpadRetriever();
    const results = retriever.retrieveRelevant('AAPL financials');
    expect(results).toHaveLength(0);
  });

  test('formatForPrompt returns empty when no relevant summaries', () => {
    const retriever = new ScratchpadRetriever();
    const formatted = retriever.formatForPrompt('some query');
    expect(formatted).toBe('');
  });

  test('retrieveRelevant matches by keyword overlap', async () => {
    const retriever = new ScratchpadRetriever();

    // Manually inject summaries (bypassing LLM indexing)
    const summaries = (retriever as any).summaries as Array<{
      toolName: string;
      args: Record<string, unknown>;
      summary: string;
      originalIndex: number;
    }>;
    (retriever as any).indexedIndices.add(0);
    (retriever as any).indexedIndices.add(1);

    summaries.push({
      toolName: 'get_financials',
      args: { query: 'AAPL revenue' },
      summary: 'Apple reported $416B revenue in FY2025 with 31% operating margin',
      originalIndex: 0,
    });
    summaries.push({
      toolName: 'web_search',
      args: { query: 'MSFT cloud growth' },
      summary: 'Microsoft Azure grew 29% YoY reaching $95B annual run rate',
      originalIndex: 1,
    });

    // Should match AAPL query
    const aaplResults = retriever.retrieveRelevant('Apple revenue and margins');
    expect(aaplResults.length).toBeGreaterThanOrEqual(1);
    expect(aaplResults[0].toolName).toBe('get_financials');

    // Should match MSFT query
    const msftResults = retriever.retrieveRelevant('Microsoft Azure cloud');
    expect(msftResults.length).toBeGreaterThanOrEqual(1);
    expect(msftResults[0].toolName).toBe('web_search');
  });

  test('formatForPrompt includes header and summaries', () => {
    const retriever = new ScratchpadRetriever();
    const summaries = (retriever as any).summaries as Array<any>;
    summaries.push({
      toolName: 'get_financials',
      args: { query: 'AAPL' },
      summary: 'Revenue was $416B',
      originalIndex: 0,
    });

    const formatted = retriever.formatForPrompt('AAPL financial data');
    expect(formatted).toContain('Previously Retrieved Data');
    expect(formatted).toContain('get_financials');
    expect(formatted).toContain('Revenue was $416B');
  });
});
