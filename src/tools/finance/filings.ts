import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { halalTerminalGet } from '../../integrations/halalterminal/client.js';
import { formatToolResult } from '../types.js';

export interface FilingItemType {
  name: string;
  title: string;
  description: string;
}

export interface FilingItemTypes {
  '10-K': FilingItemType[];
  '10-Q': FilingItemType[];
}

export async function getFilingItemTypes(): Promise<FilingItemTypes> {
  return {
    '10-K': [
      { name: 'Item-1', title: 'Business', description: 'Business overview' },
      { name: 'Item-1A', title: 'Risk Factors', description: 'Risk factor disclosure' },
      { name: 'Item-7', title: 'MD&A', description: 'Management discussion and analysis' },
      { name: 'Item-8', title: 'Financial Statements', description: 'Audited financial statements' },
    ],
    '10-Q': [
      { name: 'Part-1,Item-1', title: 'Financial Statements', description: 'Quarterly financial statements' },
      { name: 'Part-1,Item-2', title: 'MD&A', description: 'Quarterly management discussion and analysis' },
      { name: 'Part-2,Item-1A', title: 'Risk Factors', description: 'Quarterly risk factor updates' },
    ],
  };
}

async function halalGet(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const response = await halalTerminalGet(path, params);
  return { data: response.data, url: response.url };
}

const FilingsInputSchema = z.object({
  ticker: z.string().describe("The stock ticker symbol to fetch filings for, for example 'AAPL'."),
  filing_type: z.array(z.enum(['10-K', '10-Q', '8-K'])).optional(),
  limit: z.number().default(10),
});

export const getFilings = new DynamicStructuredTool({
  name: 'get_filings',
  description:
    'Retrieves SEC filing metadata for a company through Halal Terminal. Returns recent filings and source URLs for follow-up analysis.',
  schema: FilingsInputSchema,
  func: async (input) => {
    const ticker = input.ticker.toUpperCase();
    const filingTypes = input.filing_type && input.filing_type.length > 0 ? input.filing_type : [undefined];
    const results = await Promise.all(
      filingTypes.map((filingType) =>
        halalGet(`/api/filings/${ticker}`, {
          filing_type: filingType,
          limit: input.limit ?? 10,
        }),
      ),
    );

    return formatToolResult(
      {
        source: 'halalterminal',
        ticker,
        filings: results.map((result) => result.data),
      },
      results.map((result) => result.url),
    );
  },
});

const FilingItemsInputSchema = z.object({
  ticker: z.string().describe("The stock ticker symbol, for example 'AAPL'."),
  accession_number: z.string().optional(),
  items: z.array(z.string()).optional(),
});

function filingItemContinuationTool(name: string, description: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name,
    description,
    schema: FilingItemsInputSchema,
    func: async (input) =>
      formatToolResult(
        {
          source: 'halalterminal',
          ticker: input.ticker.toUpperCase(),
          accession_number: input.accession_number,
          requested_items: input.items,
          retrieval_strategy:
            'Continue from filing metadata: use read_filings to get SEC URLs, then web_fetch the returned document URL for exact item text.',
          internal_research_plan: [
            'Call read_filings for the ticker and filing type.',
            'Select the most relevant returned SEC filing URL or document URL.',
            'Call web_fetch on that URL and extract the requested item text.',
          ],
        },
        [],
      ),
  });
}

export const get10KFilingItems = filingItemContinuationTool(
  'get_10K_filing_items',
  'Plan 10-K item text retrieval by continuing from Halal Terminal filing metadata to SEC document fetch.',
);

export const get10QFilingItems = filingItemContinuationTool(
  'get_10Q_filing_items',
  'Plan 10-Q item text retrieval by continuing from Halal Terminal filing metadata to SEC document fetch.',
);

export const get8KFilingItems = filingItemContinuationTool(
  'get_8K_filing_items',
  'Plan 8-K item text retrieval by continuing from Halal Terminal filing metadata to SEC document fetch.',
);
