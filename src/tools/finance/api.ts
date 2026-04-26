export interface ApiResponse {
  data: Record<string, unknown>;
  url: string;
}

/**
 * Remove redundant fields from API payloads before they are returned to the LLM.
 * This reduces token usage while preserving the financial metrics needed for analysis.
 */
export function stripFieldsDeep(value: unknown, fields: readonly string[]): unknown {
  const fieldsToStrip = new Set(fields);

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (!node || typeof node !== 'object') {
      return node;
    }

    const record = node as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(record)) {
      if (fieldsToStrip.has(key)) {
        continue;
      }
      cleaned[key] = walk(child);
    }

    return cleaned;
  }

  return walk(value);
}

function financialDatasetsDisabled(): never {
  throw new Error(
    'Legacy finance requester is disabled. Use get_financials, get_market_data, read_filings, stock_screener, or get_shariah for the current finance workflow.',
  );
}

export const api = {
  async get(
    _endpoint: string,
    _params: Record<string, string | number | string[] | undefined>,
    _options?: { cacheable?: boolean },
  ): Promise<ApiResponse> {
    financialDatasetsDisabled();
  },

  async post(
    _endpoint: string,
    _body: Record<string, unknown>,
  ): Promise<ApiResponse> {
    financialDatasetsDisabled();
  },
};

/** @deprecated Use `api.get` instead */
export const callApi = api.get;
