import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadState, saveState } from './state.js';

describe('watch state', () => {
  test('missing file loads as empty', () => {
    expect(loadState(join(tmpdir(), 'does-not-exist-xyz.json'))).toEqual({});
  });

  test('save then load round-trips the verdict map', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'yassir-watch-')), 'state.json');
    saveState(path, { AAPL: { is_compliant: true }, X: { is_compliant: null } });
    expect(loadState(path)).toEqual({ AAPL: { is_compliant: true }, X: { is_compliant: null } });
  });

  test('corrupt file loads as empty (never throws)', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'yassir-watch-')), 'state.json');
    require('fs').writeFileSync(path, 'not json{{');
    expect(loadState(path)).toEqual({});
  });
});
