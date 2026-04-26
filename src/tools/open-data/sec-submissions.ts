import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchJson, finalizeOpenDataResult } from './common.js';

export const SEC_SUBMISSIONS_DESCRIPTION = `
Look up recent SEC submissions for a US-listed company directly from the SEC submissions API.

Use this for filing recency, form mix, accession numbers, and recent reporting cadence.
`.trim();

type TickerEntry = {
  ticker?: string;
  cik_str?: number;
  title?: string;
};

export const secSubmissionsTool = new DynamicStructuredTool({
  name: 'sec_submissions',
  description: SEC_SUBMISSIONS_DESCRIPTION,
  schema: z.object({
    ticker: z.string().describe('US stock ticker, e.g. AAPL or MSFT'),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  func: async (input) => {
    const ticker = input.ticker.trim().toUpperCase();
    const limit = input.limit ?? 10;
    const tickerMap = await fetchJson<Record<string, TickerEntry>>('https://www.sec.gov/files/company_tickers.json');
    const entry = Object.values(tickerMap).find((item) => item.ticker?.toUpperCase() === ticker);
    if (!entry?.cik_str) {
      throw new Error(`[SEC] Unknown ticker: ${ticker}`);
    }

    const cik = String(entry.cik_str).padStart(10, '0');
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const submissions = await fetchJson<Record<string, unknown>>(url);
    const recent = (submissions.filings as Record<string, unknown> | undefined)?.recent as
      | Record<string, unknown[]>
      | undefined;

    const forms = Array.isArray(recent?.form) ? recent.form : [];
    const filingDates = Array.isArray(recent?.filingDate) ? recent.filingDate : [];
    const accessionNumbers = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber : [];
    const primaryDocs = Array.isArray(recent?.primaryDocument) ? recent.primaryDocument : [];

    const items = forms.slice(0, limit).map((form, index) => ({
      form,
      filingDate: filingDates[index],
      accessionNumber: accessionNumbers[index],
      primaryDocument: primaryDocs[index],
    }));

    return finalizeOpenDataResult(
      {
        ticker,
        companyName: submissions.name,
        cik,
        recentFilings: items,
      },
      [url],
    );
  },
});
