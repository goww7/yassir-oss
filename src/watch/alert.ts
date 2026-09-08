/** Pure alert formatting + filtering for `yassir watch`. */
import type { Change, ChangeKind } from './diff.js';

const ICON: Record<ChangeKind, string> = {
  flipped_out: '🔴',
  became_unknown: '🟠',
  flipped_in: '🟢',
  resolved: '🔵',
  new: '•',
};

const LABEL: Record<ChangeKind, string> = {
  flipped_out: 'NO LONGER COMPLIANT',
  flipped_in: 'now compliant',
  became_unknown: 'verdict now indeterminate',
  resolved: 'verdict resolved',
  new: 'now tracked',
};

export function formatChange(c: Change): string {
  return `${ICON[c.kind]} ${c.symbol} — ${LABEL[c.kind]}`;
}

/** Changes worth surfacing. By default the baseline `new` entries are silent. */
export function alertableChanges(changes: Change[], includeBaseline = false): Change[] {
  return changes.filter((c) => includeBaseline || c.kind !== 'new');
}

export type WebhookFormat = 'discord' | 'slack' | 'raw';

function isDiscordHost(host: string): boolean {
  return host === 'discord.com' || host.endsWith('.discord.com')
    || host === 'discordapp.com' || host.endsWith('.discordapp.com');
}

function isSlackHost(host: string): boolean {
  return host === 'hooks.slack.com';
}

// Matches against the parsed URL's hostname + path, not the raw string, so a
// third-party/proxy URL that merely contains "discord.com/api/webhooks/" or
// "hooks.slack.com/" somewhere in its path (or query) isn't misclassified.
export function detectWebhookFormat(url: string): WebhookFormat {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'raw';
  }
  const host = parsed.hostname.toLowerCase();
  if (isDiscordHost(host) && parsed.pathname.startsWith('/api/webhooks/')) return 'discord';
  if (isSlackHost(host)) return 'slack';
  return 'raw';
}

export const DISCORD_CONTENT_LIMIT = 2000;
export const SLACK_TEXT_LIMIT = 40000;


const HEADER_RESERVE = 100;

export function formatAlertMessage(changes: Change[]): string {
  return [`⚠️ ${changes.length} compliance change(s):`, ...changes.map(formatChange)].join('\n');
}


export function chunkAlertMessages(changes: Change[], limit: number): string[] {
  if (changes.length === 0) return [];
  const budget = Math.max(1, limit - HEADER_RESERVE);
  const lines = changes.map((c) => {
    const line = formatChange(c);
    return line.length > budget ? `${line.slice(0, budget - 1)}…` : line;
  });

  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const line of lines) {
    const nextLen = current.length === 0 ? line.length : currentLen + 1 + line.length;
    if (nextLen > budget && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen = current.length === 1 ? line.length : currentLen + 1 + line.length;
  }
  if (current.length) chunks.push(current);

  const total = chunks.length;
  return chunks.map((chunkLines, i) => {
    const header = total > 1
      ? `⚠️ compliance changes ${i + 1}/${total} (${changes.length} total):`
      : `⚠️ ${changes.length} compliance change(s):`;
    return [header, ...chunkLines].join('\n');
  });
}

export interface BuildWebhookPayloadOptions {
  format?: WebhookFormat;
  //default to now for tests. prod never sets it, defaulting to date at call time
  now?: Date;
}

export function buildWebhookPayloads(
  url: string,
  changes: Change[],
  opts: BuildWebhookPayloadOptions = {},
): { body: unknown }[] {
  const format = opts.format ?? detectWebhookFormat(url);
  if (format === 'discord') {
    return chunkAlertMessages(changes, DISCORD_CONTENT_LIMIT).map((content) => ({ body: { content } }));
  }
  if (format === 'slack') {
    return chunkAlertMessages(changes, SLACK_TEXT_LIMIT).map((text) => ({ body: { text } }));
  }
  const at = opts.now ?? new Date();
  return [{ body: { source: 'yassir-watch', at: at.toISOString(), changes } }];
}
