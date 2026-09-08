/** `yassir watch` command: parse args, resolve symbols, run once or loop. */
import { join } from 'path';
import { getHalalTerminalApiKey, halalTerminalGet } from '../integrations/halalterminal/client.js';
import type { WebhookFormat } from './alert.js';
import { runOnce, runWatch, type WatchOptions } from './monitor.js';

//allowed "raw" format as well, which is just a generic format flag not actually required for raw webhooks, but can be used to override auto-detection of discord/slack
const WEBHOOK_FORMATS: WebhookFormat[] = ['discord', 'slack', 'raw'];

const DEFAULT_INTERVAL_MIN = 360; // 6h

export interface ParsedWatch {
  symbols: string[];
  watchlist?: string;
  intervalMs: number;
  once: boolean;
  forceRefresh: boolean;
  webhook?: string;
  webhookFormat?: WebhookFormat;
  json: boolean;
  statePath: string;
}

export function parseWatchArgs(argv: string[]): ParsedWatch | { error: string } {
  const symbols: string[] = [];
  let watchlist: string | undefined;
  let intervalMin = DEFAULT_INTERVAL_MIN;
  let once = false;
  let forceRefresh = false;
  let webhook: string | undefined;
  let webhookFormat: WebhookFormat | undefined;
  let json = false;
  let statePath = join(process.cwd(), '.yassir', 'watch-state.json');

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--once') once = true;
    else if (a === '--json') json = true;
    else if (a === '--force' || a === '--refresh') forceRefresh = true;
    else if (a === '--interval') intervalMin = Number(argv[++i]);
    else if (a === '--webhook') webhook = argv[++i];
    else if (a === '--format') {
      const value = argv[++i];
      if (value === undefined) return { error: '--format requires a value' };
      webhookFormat = value as WebhookFormat;
    }
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
  if (webhookFormat !== undefined && !WEBHOOK_FORMATS.includes(webhookFormat)) {
    return { error: `--format must be one of: ${WEBHOOK_FORMATS.join(', ')}` };
  }

  return {
    symbols,
    watchlist,
    intervalMs: intervalMin * 60_000,
    once,
    forceRefresh,
    webhook,
    webhookFormat,
    json,
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
    console.error(
      'usage: yassir watch <SYMBOLS|watchlist:NAME> [--once] [--json] [--interval MIN] [--webhook URL] [--format discord|slack|raw] [--force]',
    );
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
    webhookFormat: parsed.webhookFormat,
    json: parsed.json,
  };

  if (parsed.once) {
    await runOnce(symbols, opts);
  } else {
    await runWatch(symbols, parsed.intervalMs, opts);
  }
}
