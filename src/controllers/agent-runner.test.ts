import { describe, expect, test } from 'bun:test';
import { AgentRunnerController } from './agent-runner.js';
import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';

describe('AgentRunnerController clarification flow', () => {
  test('stores clarification prompts without completing the turn', () => {
    const runner = new AgentRunnerController({}, new InMemoryChatHistory());

    runner.showClarification('Give me a benchmark on ASML', {
      question: 'Should I focus on moat, valuation, or both?',
      mode: 'inline',
      label: 'Focus',
    });

    expect(runner.history).toHaveLength(1);
    expect(runner.history[0]?.status).toBe('awaiting_clarification');
    expect(runner.history[0]?.events[0]?.event.type).toBe('clarification_needed');
    expect(runner.history[0]?.historySaved).toBe(false);
  });

  test('dismisses pending clarification cleanly', () => {
    const runner = new AgentRunnerController({}, new InMemoryChatHistory());

    runner.showClarification('Analyze Apple risks', {
      question: 'Do you want a board memo or a quick brief?',
      mode: 'single_select',
      label: 'Deliverable',
      options: [
        { value: 'memo', label: 'Board memo' },
        { value: 'brief', label: 'Quick brief' },
      ],
    });
    runner.dismissPendingClarification();

    expect(runner.history[0]?.status).toBe('interrupted');
  });
});
