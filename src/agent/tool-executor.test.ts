import { describe, expect, test } from 'bun:test';
import { TOOLS_REQUIRING_APPROVAL } from './tool-executor.js';

describe('TOOLS_REQUIRING_APPROVAL', () => {
  test('includes mutating Halal Terminal tools', () => {
    expect(TOOLS_REQUIRING_APPROVAL).toContain('screen_index_bulk');
    expect(TOOLS_REQUIRING_APPROVAL).toContain('create_watchlist');
    expect(TOOLS_REQUIRING_APPROVAL).toContain('delete_watchlist');
    expect(TOOLS_REQUIRING_APPROVAL).toContain('add_watchlist_symbol');
    expect(TOOLS_REQUIRING_APPROVAL).toContain('remove_watchlist_symbol');
    expect(TOOLS_REQUIRING_APPROVAL).toContain('create_checkout');
    expect(TOOLS_REQUIRING_APPROVAL).toContain('regenerate_key');
  });
});
