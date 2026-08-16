import { describe, expect, test } from 'bun:test';
import { buildWebhookPayload, formatJsonOutput, parseVerdict } from './monitor.js';

describe('parseVerdict', () => {
  test('reads a boolean compliance verdict', () => {
    expect(parseVerdict({ is_compliant: true })).toEqual({ is_compliant: true });
    expect(parseVerdict({ is_compliant: false })).toEqual({ is_compliant: false });
  });

  describe('formatJsonOutput', () => {
  test('returns machine-readable watch JSON', () => {
    const output = formatJsonOutput(
      ['AAPL', 'MSFT'],
      []
    );

    const parsed = JSON.parse(output);

    expect(parsed.symbols).toEqual(['AAPL', 'MSFT']);
    expect(parsed.changes).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(typeof parsed.ts).toBe('string');
  });
});

  test('maps indeterminate / missing / malformed to null', () => {
    expect(parseVerdict({ is_compliant: null })).toEqual({ is_compliant: null });
    expect(parseVerdict({})).toEqual({ is_compliant: null });
    expect(parseVerdict({ is_compliant: 'yes' })).toEqual({ is_compliant: null });
    expect(parseVerdict(null)).toEqual({ is_compliant: null });
    expect(parseVerdict('nope')).toEqual({ is_compliant: null });
  });
});
describe('buildWebhookPayload', () => {
const changes = [
  {
    symbol: 'AAPL',
    kind: 'flipped_out',
    from: true,
    to: false,
  },
] as const;
  test('formats Discord webhooks with content', () => {
    const payload = buildWebhookPayload(
      'https://discord.com/api/webhooks/123/test',
      [...changes],
    );

    expect(payload).toEqual({
      content: expect.stringContaining('AAPL'),
    });
  });

  test('formats Slack webhooks with text', () => {
    const payload = buildWebhookPayload(
      'https://hooks.slack.com/services/T/B/X',
      [...changes],
    );

    expect(payload).toEqual({
      text: expect.stringContaining('AAPL'),
    });
  });

  test('keeps generic webhook payload unchanged', () => {
    const payload = buildWebhookPayload(
      'https://example.com/webhook',
      [...changes],
    );

    expect(payload).toMatchObject({
      source: 'yassir-watch',
      changes: [...changes],
    });

    expect(typeof (payload as { at?: unknown }).at).toBe('string');
  });
});
