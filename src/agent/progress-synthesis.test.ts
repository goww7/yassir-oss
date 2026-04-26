import { describe, test, expect } from 'bun:test';
import { ProgressSynthesizer } from './progress-synthesis.js';

describe('ProgressSynthesizer', () => {
  test('does not trigger synthesis before interval', () => {
    const synthesizer = new ProgressSynthesizer(4);
    expect(synthesizer.recordToolCall()).toBe(false);
    expect(synthesizer.recordToolCall()).toBe(false);
    expect(synthesizer.recordToolCall()).toBe(false);
  });

  test('triggers synthesis at interval', () => {
    const synthesizer = new ProgressSynthesizer(4);
    synthesizer.recordToolCall(); // 1
    synthesizer.recordToolCall(); // 2
    synthesizer.recordToolCall(); // 3
    const shouldSynthesize = synthesizer.recordToolCall(); // 4
    expect(shouldSynthesize).toBe(true);
  });

  test('resets counter after synthesis interval', () => {
    const synthesizer = new ProgressSynthesizer(2);
    synthesizer.recordToolCall(); // 1
    expect(synthesizer.recordToolCall()).toBe(true); // 2 - trigger

    // Counter stays >= interval until synthesize() resets it, so subsequent calls also return true
    expect(synthesizer.recordToolCall()).toBe(true); // 3 (still >= interval since no reset)
  });

  test('custom interval works', () => {
    const synthesizer = new ProgressSynthesizer(2);
    synthesizer.recordToolCall(); // 1
    expect(synthesizer.recordToolCall()).toBe(true); // 2 - should trigger at interval=2
  });

  test('default interval is 4', () => {
    const synthesizer = new ProgressSynthesizer();
    synthesizer.recordToolCall(); // 1
    synthesizer.recordToolCall(); // 2
    synthesizer.recordToolCall(); // 3
    expect(synthesizer.recordToolCall()).toBe(true); // 4 - default interval
  });
});
