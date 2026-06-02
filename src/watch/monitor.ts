/**
 * `yassir watch` runner — continuously re-screens a set of symbols and alerts on
 * compliance drift. Uses the Halal Terminal client directly (no LLM in the loop)
 * so monitoring is deterministic and cheap.
 */
import { halalTerminalGet, halalTerminalPost } from '../integrations/halalterminal/client.js';
import { diffVerdicts, type Change, type Verdict, type VerdictMap } from './diff.js';
import { alertableChanges, formatChange } from './alert.js';
import { loadState, saveState } from './state.js';

export function parseVerdict(payload: unknown): Verdict {
  const rec = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return { is_compliant: typeof rec.is_compliant === 'boolean' ? rec.is_compliant : null };
}

export async function fetchVerdicts(
  symbols: string[],
  opts: { forceRefresh?: boolean } = {},
): Promise<VerdictMap> {
  const out: VerdictMap = {};
  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym || out[sym]) continue;
    try {
      const res = opts.forceRefresh
        ? await halalTerminalPost(`/api/screen/${encodeURIComponent(sym)}`, {})
        : await halalTerminalGet(`/api/result/${encodeURIComponent(sym)}`);
      out[sym] = parseVerdict(res.data);
    } catch {
      out[sym] = { is_compliant: null };
    }
  }
  return out;
}

async function sendWebhook(url: string, changes: Change[]): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'yassir-watch', at: new Date().toISOString(), changes }),
    });
  } catch {
    /* best-effort; never crash the daemon on a webhook failure */
  }
}

export interface WatchOptions {
  statePath: string;
  forceRefresh?: boolean;
  webhook?: string;
  quiet?: boolean;
}

export interface RunOnceResult {
  verdicts: VerdictMap;
  changes: Change[];
  alerts: Change[];
}

export async function runOnce(symbols: string[], opts: WatchOptions): Promise<RunOnceResult> {
  const prev = loadState(opts.statePath);
  const verdicts = await fetchVerdicts(symbols, { forceRefresh: opts.forceRefresh });
  const changes = diffVerdicts(prev, verdicts);
  const alerts = alertableChanges(changes, false);

  if (!opts.quiet) {
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (alerts.length === 0) {
      console.log(`[${stamp}] ✅ ${Object.keys(verdicts).length} watched — no compliance changes.`);
    } else {
      console.log(`[${stamp}] ⚠️  ${alerts.length} compliance change(s):`);
      for (const c of alerts) console.log(`   ${formatChange(c)}`);
    }
  }

  if (alerts.length && opts.webhook) await sendWebhook(opts.webhook, alerts);
  saveState(opts.statePath, { ...prev, ...verdicts });
  return { verdicts, changes, alerts };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runWatch(
  symbols: string[],
  intervalMs: number,
  opts: WatchOptions,
): Promise<void> {
  let stop = false;
  const onSig = () => {
    stop = true;
    console.log('\nstopping watch…');
  };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  console.log(
    `Watching ${symbols.length} symbol(s) every ${Math.round(intervalMs / 60000)} min. Ctrl-C to stop.`,
  );
  while (!stop) {
    try {
      await runOnce(symbols, opts);
    } catch (err) {
      console.error('watch cycle error:', err instanceof Error ? err.message : String(err));
    }
    // Sleep in short slices so Ctrl-C is responsive.
    for (let waited = 0; waited < intervalMs && !stop; waited += 1000) {
      await sleep(Math.min(1000, intervalMs - waited));
    }
  }
}
