import { describe, expect, test } from 'bun:test';
import { parseWatchArgs } from './cli.js';

function ok(r: ReturnType<typeof parseWatchArgs>) {
  if ('error' in r) throw new Error(`expected parse, got error: ${r.error}`);
  return r;
}

describe('parseWatchArgs', () => {
  test('parses comma-separated symbols with defaults (6h, loop)', () => {
    const r = ok(parseWatchArgs(['AAPL,MSFT,GOOGL']));
    expect(r.symbols).toEqual(['AAPL', 'MSFT', 'GOOGL']);
    expect(r.intervalMs).toBe(360 * 60_000);
    expect(r.once).toBe(false);
    expect(r.statePath).toContain('watch-state.json');
  });

  test('parses flags: --once --interval --webhook --force', () => {
    const r = ok(parseWatchArgs(['NVDA', '--once', '--interval', '30', '--webhook', 'https://x.test/hook', '--force']));
    expect(r.once).toBe(true);
    expect(r.intervalMs).toBe(30 * 60_000);
    expect(r.webhook).toBe('https://x.test/hook');
    expect(r.forceRefresh).toBe(true);
  });

  test('parses watchlist:NAME', () => {
    const r = ok(parseWatchArgs(['watchlist:My Halal Stocks']));
    expect(r.watchlist).toBe('My Halal Stocks');
  });

  test('errors when no symbols or watchlist given', () => {
    expect(parseWatchArgs(['--once'])).toEqual({ error: expect.stringContaining('provide symbols') });
  });

  test('rejects a non-http webhook and a bad interval', () => {
    expect('error' in parseWatchArgs(['AAPL', '--webhook', 'ftp://x'])).toBe(true);
    expect('error' in parseWatchArgs(['AAPL', '--interval', '0'])).toBe(true);
  });
});
