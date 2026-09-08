import { describe, expect, test } from 'bun:test';
import {
  formatChange,
  alertableChanges,
  detectWebhookFormat,
  formatAlertMessage,
  chunkAlertMessages,
  buildWebhookPayloads,
  DISCORD_CONTENT_LIMIT,
  SLACK_TEXT_LIMIT,
} from './alert.js';
import type { Change } from './diff.js';

describe('watch alerts', () => {
  test('formats a flipped_out change prominently', () => {
    const s = formatChange({ symbol: 'AAPL', kind: 'flipped_out', from: true, to: false });
    expect(s).toContain('AAPL');
    expect(s).toContain('🔴');
  });

  test('alertableChanges drops baseline "new" by default', () => {
    const changes: Change[] = [
      { symbol: 'A', kind: 'new', from: undefined, to: true },
      { symbol: 'B', kind: 'flipped_out', from: true, to: false },
    ];
    expect(alertableChanges(changes).map((c) => c.symbol)).toEqual(['B']);
  });

  test('alertableChanges can include baseline when asked', () => {
    const changes: Change[] = [{ symbol: 'A', kind: 'new', from: undefined, to: true }];
    expect(alertableChanges(changes, true)).toHaveLength(1);
  });
});

describe('webhook format detection', () => {
  test('detects Discord webhook URLs', () => {
    expect(detectWebhookFormat('https://discord.com/api/webhooks/123/abc')).toBe('discord');
    expect(detectWebhookFormat('https://discordapp.com/api/webhooks/123/abc')).toBe('discord');
    expect(detectWebhookFormat('https://ptb.discord.com/api/webhooks/123/abc')).toBe('discord');
  });

  test('detects Slack webhook URLs', () => {
    expect(detectWebhookFormat('https://hooks.slack.com/services/T00/B00/xyz')).toBe('slack');
  });

  test('falls back to raw for anything else', () => {
    expect(detectWebhookFormat('https://example.com/hook')).toBe('raw');
  });

  test('does not misclassify a third-party URL that merely contains a Discord/Slack path', () => {
    expect(detectWebhookFormat('https://example.com/forward/https://discord.com/api/webhooks/1/a')).toBe('raw');
    expect(detectWebhookFormat('https://example.com/?u=https://hooks.slack.com/services/T/B/x')).toBe('raw');
  });

  test('rejects an unparseable URL as raw instead of throwing', () => {
    expect(detectWebhookFormat('not a url')).toBe('raw');
  });
});

describe('formatAlertMessage', () => {
  test('joins a header and each formatted change, keeping the icons', () => {
    const changes: Change[] = [
      { symbol: 'AAPL', kind: 'flipped_out', from: true, to: false },
      { symbol: 'MSFT', kind: 'flipped_in', from: false, to: true },
    ];
    const msg = formatAlertMessage(changes);
    expect(msg).toContain('2 compliance change(s)');
    expect(msg).toContain('🔴 AAPL — NO LONGER COMPLIANT');
    expect(msg).toContain('🟢 MSFT — now compliant');
  });
});

describe('chunkAlertMessages', () => {
  test('fits everything into one message when it is well under the limit', () => {
    const changes: Change[] = [
      { symbol: 'AAPL', kind: 'flipped_out', from: true, to: false },
      { symbol: 'MSFT', kind: 'flipped_in', from: false, to: true },
    ];
    const chunks = chunkAlertMessages(changes, DISCORD_CONTENT_LIMIT);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('🔴 AAPL');
    expect(chunks[0]).toContain('🟢 MSFT');
  });

  test('splits a large watchlist across multiple messages, each under the limit', () => {
    const changes: Change[] = Array.from({ length: 500 }, (_, i) => ({
      symbol: `SYM${i}`,
      kind: 'flipped_out' as const,
      from: true,
      to: false,
    }));
    const limit = 200;
    const chunks = chunkAlertMessages(changes, limit);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(limit);
    // every change still shows up somewhere across the chunks — nothing dropped
    const joined = chunks.join('\n');
    for (const c of changes) expect(joined).toContain(c.symbol);
  });

  test('returns nothing for an empty change list', () => {
    expect(chunkAlertMessages([], DISCORD_CONTENT_LIMIT)).toEqual([]);
  });
});

describe('buildWebhookPayloads', () => {
  const changes: Change[] = [{ symbol: 'AAPL', kind: 'flipped_out', from: true, to: false }];

  test('shapes a single-element Discord payload with a "content" field, auto-detected from the URL', () => {
    const payloads = buildWebhookPayloads('https://discord.com/api/webhooks/1/abc', changes);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.body).toEqual({ content: formatAlertMessage(changes) });
  });

  test('shapes a single-element Slack payload with a "text" field, auto-detected from the URL', () => {
    const payloads = buildWebhookPayloads('https://hooks.slack.com/services/T00/B00/xyz', changes);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.body).toEqual({ text: formatAlertMessage(changes) });
  });

  test('an explicit format overrides URL detection', () => {
    const payloads = buildWebhookPayloads('https://example.com/hook', changes, { format: 'discord' }) as {
      body: { content: string };
    }[];
    expect(payloads[0]!.body.content).toContain('🔴 AAPL');
  });

  test('keeps the raw JSON envelope as a single payload for plain webhooks (no breaking change)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const payloads = buildWebhookPayloads('https://example.com/hook', changes, { now });
    expect(payloads).toEqual([{ body: { source: 'yassir-watch', at: now.toISOString(), changes } }]);
  });

  test('splits a large watchlist across several Discord requests, each within the length cap', () => {
    const many: Change[] = Array.from({ length: 500 }, (_, i) => ({
      symbol: `SYM${i}`,
      kind: 'flipped_out' as const,
      from: true,
      to: false,
    }));
    const payloads = buildWebhookPayloads('https://discord.com/api/webhooks/1/abc', many) as {
      body: { content: string };
    }[];
    expect(payloads.length).toBeGreaterThan(1);
    for (const { body } of payloads) expect(body.content.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
  });

  test('a batch that fits Slack in one message still respects SLACK_TEXT_LIMIT', () => {
    const payloads = buildWebhookPayloads('https://hooks.slack.com/services/T00/B00/xyz', changes) as {
      body: { text: string };
    }[];
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.body.text.length).toBeLessThanOrEqual(SLACK_TEXT_LIMIT);
  });
});
