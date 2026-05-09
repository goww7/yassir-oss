import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { halalTerminalGet } from './client.js';

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

const originalFetch = globalThis.fetch;

function installFetch(handler: FetchHandler): void {
  (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init ?? {});
  }) as typeof globalThis.fetch;
}

function restoreFetch(): void {
  (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = originalFetch;
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('halalterminal client retry', () => {
  let originalKey: string | undefined;
  beforeEach(() => {
    originalKey = process.env.HALAL_TERMINAL_API_KEY;
    process.env.HALAL_TERMINAL_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.HALAL_TERMINAL_API_KEY;
    } else {
      process.env.HALAL_TERMINAL_API_KEY = originalKey;
    }
    restoreFetch();
  });

  test('retries 429 up to 2 times then succeeds', async () => {
    let calls = 0;
    installFetch(() => {
      calls += 1;
      if (calls < 3) {
        return jsonResponse({ message: 'rate limited' }, { status: 429 });
      }
      return jsonResponse({ ok: true });
    });

    const result = await halalTerminalGet('/api/quote/AAPL');
    expect(calls).toBe(3);
    expect(result.data).toEqual({ ok: true });
  });

  test('surfaces 429 with quota hint after retries are exhausted', async () => {
    let calls = 0;
    installFetch(() => {
      calls += 1;
      return jsonResponse({ message: 'still rate limited' }, { status: 429 });
    });

    let caught: Error | null = null;
    try {
      await halalTerminalGet('/api/quote/AAPL');
    } catch (err) {
      caught = err instanceof Error ? err : new Error(String(err));
    }

    expect(calls).toBe(3); // initial + 2 retries
    expect(caught?.message).toContain('429');
    expect(caught?.message).toContain('get_key_usage');
  });

  test('does not retry on 500', async () => {
    let calls = 0;
    installFetch(() => {
      calls += 1;
      return jsonResponse({ message: 'boom' }, { status: 500 });
    });

    let caught: Error | null = null;
    try {
      await halalTerminalGet('/api/quote/AAPL');
    } catch (err) {
      caught = err instanceof Error ? err : new Error(String(err));
    }

    expect(calls).toBe(1);
    expect(caught?.message).toContain('500');
  });
});
