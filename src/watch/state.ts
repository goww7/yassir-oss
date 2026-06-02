/** Persisted monitor state so `yassir watch` detects changes across runs/restarts. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { VerdictMap } from './diff.js';

export function loadState(path: string): VerdictMap {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { verdicts?: VerdictMap };
    return parsed && typeof parsed === 'object' && parsed.verdicts ? parsed.verdicts : {};
  } catch {
    return {}; // corrupt state must never crash the daemon
  }
}

export function saveState(path: string, verdicts: VerdictMap): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ updated_at: new Date().toISOString(), verdicts }, null, 2));
}
