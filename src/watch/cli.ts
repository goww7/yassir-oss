/** `yassir watch` command: parse args, resolve symbols, run once or loop. */
import { join } from 'path';
import { getHalalTerminalApiKey, halalTerminalGet } from '../integrations/halalterminal/client.js';
import { runOnce, runWatch, type WatchOptions } from './monitor.js';

const DEFAULT_INTERVAL_MIN = 360; // 6h

export interface ParsedWatch {
  symbols: string[];
  watchlist?: string;
  intervalMs: number;
  once: boolean;
  forceRefresh: boolean;
  webhook?: string;
  statePath: string;
}

export function parseWatchArgs(argv: string[]): ParsedWatch | { error: string } {
  const symbols: string[] = [];
  let watchlist: string | undefined;
  let intervalMin = DEFAULT_INTERVAL_MIN;
  let once = false;
  let forceRefresh = false;
  let webhook: string | undefined;
  let statePath = join(process.cwd(), '.yassir', 'watch-state.json');

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--once') once = true;
    else if (a === '--force' || a === '--refresh') forceRefresh = true;
    else if (a === '--interval') intervalMin = Number(argv[++i]);
    else if (a === '--webhook') webhook = argv[++i];
    else if (a === '--state') statePath = argv[++i]!;
    else if (a.startsWith('watchlist:')) watchlist = a.slice('watchlist:'.length).trim();
    else if (a.startsWith('--')) return { error: `unknown flag: ${a}` };
    else symbols.push(...a.split(',').map((s) => s.trim()).filter(Boolean));
  }

  if (symbols.length === 0 && !watchlist) {
    return { error: 'provide symbols (e.g. "AAPL,MSFT,GOOGL") or watchlist:<name>' };
  }
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) {
    return { error: '--interval must be a positive number of minutes' };
  }
  if (webhook !== undefined && !/^https?:\/\//.test(webhook)) {
    return { error: '--webhook must be an http(s) URL' };
  }

  return {
    symbols,
    watchlist,
    intervalMs: intervalMin * 60_000,
    once,
    forceRefresh,
    webhook,
    statePath,
  };
}

async function resolveWatchlistSymbols(name: string): Promise<string[]> {
  const { data } = await halalTerminalGet('/api/watchlists');
  const lists = (data && typeof data === 'object' && Array.isArray((data as { watchlists?: unknown[] }).watchlists))
    ? (data as { watchlists: Array<Record<string, unknown>> }).watchlists
    : Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  const match = lists.find((w) => String(w.name).toLowerCase() === name.toLowerCase());
  if (!match) throw new Error(`watchlist "${name}" not found`);
  const syms = (match.symbols as unknown[]) ?? [];
  return syms.map((s) => (typeof s === 'string' ? s : String((s as Record<string, unknown>)?.symbol ?? ''))).filter(Boolean);
}

export async function runWatchCommand(argv: string[]): Promise<void> {
  const parsed = parseWatchArgs(argv);
  if ('error' in parsed) {
    console.error(`yassir watch: ${parsed.error}`);
    console.error('usage: yassir watch <SYMBOLS|watchlist:NAME> [--once] [--interval MIN] [--webhook URL] [--force]');
    process.exitCode = 2;
    return;
  }

  if (!getHalalTerminalApiKey()) {
    console.error('yassir watch: HALAL_TERMINAL_API_KEY is not set — get a free key at https://halalterminal.com and export it.');
    process.exitCode = 1;
    return;
  }

  let symbols = parsed.symbols;
  if (parsed.watchlist) {
    try {
      symbols = [...symbols, ...(await resolveWatchlistSymbols(parsed.watchlist))];
    } catch (err) {
      console.error(`yassir watch: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
  }
  symbols = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  if (symbols.length === 0) {
    console.error('yassir watch: no symbols to watch');
    process.exitCode = 1;
    return;
  }

  const opts: WatchOptions = {
    statePath: parsed.statePath,
    forceRefresh: parsed.forceRefresh,
    webhook: parsed.webhook,
  };

  if (parsed.once) {
    await runOnce(symbols, opts);
  } else {
    await runWatch(symbols, parsed.intervalMs, opts);
  }
}
