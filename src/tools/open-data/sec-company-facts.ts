import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchJson, finalizeOpenDataResult } from './common.js';

export const SEC_COMPANY_FACTS_DESCRIPTION = `
Look up SEC company facts and recent reported fundamentals directly from the SEC open data APIs.

Use this for US-listed companies when you want primary-source company facts, filing-linked metrics,
or a direct SEC-backed view of recent reported financial data.
`.trim();

const toolSchema = z.object({
  ticker: z.string().describe('US stock ticker, e.g. AAPL or MSFT'),
});

type TickerEntry = {
  ticker?: string;
  cik_str?: number;
  title?: string;
};

function pickLatestFact(units: Record<string, Array<Record<string, unknown>>> | undefined) {
  if (!units) return null;
  const values = Object.values(units).flat().filter((item) => typeof item?.val === 'number');
  const sorted = values.sort((a, b) => String(b.end ?? '').localeCompare(String(a.end ?? '')));
  return sorted.slice(0, 3).map((item) => ({
    value: item.val,
    end: item.end,
    form: item.form,
    filed: item.filed,
    fy: item.fy,
    fp: item.fp,
  }));
}

export const secCompanyFactsTool = new DynamicStructuredTool({
  name: 'sec_company_facts',
  description: SEC_COMPANY_FACTS_DESCRIPTION,
  schema: toolSchema,
  func: async (input) => {
    const ticker = input.ticker.trim().toUpperCase();
    const tickerMap = await fetchJson<Record<string, TickerEntry>>('https://www.sec.gov/files/company_tickers.json');
    const entry = Object.values(tickerMap).find((item) => item.ticker?.toUpperCase() === ticker);
    if (!entry?.cik_str) {
      throw new Error(`[SEC] Unknown ticker: ${ticker}`);
    }

    const cik = String(entry.cik_str).padStart(10, '0');
    const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    const facts = await fetchJson<Record<string, unknown>>(factsUrl);
    const usGaap = (facts.facts as Record<string, Record<string, unknown>> | undefined)?.['us-gaap'] ?? {};

    const concepts = {
      revenue:
        (usGaap.Revenues as Record<string, unknown> | undefined) ??
        (usGaap.RevenueFromContractWithCustomerExcludingAssessedTax as Record<string, unknown> | undefined),
      netIncome: usGaap.NetIncomeLoss as Record<string, unknown> | undefined,
      assets: usGaap.Assets as Record<string, unknown> | undefined,
      liabilities: usGaap.Liabilities as Record<string, unknown> | undefined,
      operatingCashFlow:
        usGaap.NetCashProvidedByUsedInOperatingActivities as Record<string, unknown> | undefined,
      sharesOutstanding: usGaap.CommonStockSharesOutstanding as Record<string, unknown> | undefined,
    };

    return finalizeOpenDataResult(
      {
        ticker,
        companyName: facts.entityName,
        cik,
        facts: {
          revenue: pickLatestFact(concepts.revenue?.units as Record<string, Array<Record<string, unknown>>> | undefined),
          netIncome: pickLatestFact(concepts.netIncome?.units as Record<string, Array<Record<string, unknown>>> | undefined),
          assets: pickLatestFact(concepts.assets?.units as Record<string, Array<Record<string, unknown>>> | undefined),
          liabilities: pickLatestFact(
            concepts.liabilities?.units as Record<string, Array<Record<string, unknown>>> | undefined,
          ),
          operatingCashFlow: pickLatestFact(
            concepts.operatingCashFlow?.units as Record<string, Array<Record<string, unknown>>> | undefined,
          ),
          sharesOutstanding: pickLatestFact(
            concepts.sharesOutstanding?.units as Record<string, Array<Record<string, unknown>>> | undefined,
          ),
        },
      },
      [factsUrl],
    );
  },
});
