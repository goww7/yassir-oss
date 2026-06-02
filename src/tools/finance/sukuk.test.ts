import { describe, expect, test } from 'bun:test';
import type { z } from 'zod';
import { searchSukuk, getSukuk, getSukukIssuer } from './shariah.js';

// DynamicStructuredTool types `.schema` as a broad base; cast to the zod schema
// it actually is so we can validate input contracts.
const asZod = (s: unknown) => s as z.ZodTypeAny;

describe('sukuk tools', () => {
  test('expose the expected tool names', () => {
    expect(searchSukuk.name).toBe('search_sukuk');
    expect(getSukuk.name).toBe('get_sukuk');
    expect(getSukukIssuer.name).toBe('get_sukuk_issuer');
  });

  test('search_sukuk facets are all optional (empty search is valid)', () => {
    expect(asZod(searchSukuk.schema).safeParse({}).success).toBe(true);
    expect(asZod(searchSukuk.schema).safeParse({ structure: 'ijara', currency: 'USD' }).success).toBe(true);
  });

  test('get_sukuk requires an ISIN', () => {
    expect(asZod(getSukuk.schema).safeParse({}).success).toBe(false);
    expect(asZod(getSukuk.schema).safeParse({ isin: 'XS1234567890' }).success).toBe(true);
  });

  test('get_sukuk_issuer requires a LEI', () => {
    expect(asZod(getSukukIssuer.schema).safeParse({ lei: '5493001KJTIIGC8Y1R12' }).success).toBe(true);
    expect(asZod(getSukukIssuer.schema).safeParse({}).success).toBe(false);
  });
});
