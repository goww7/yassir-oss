import { beforeEach, describe, expect, test } from 'bun:test';
import { GuidedQaController } from './guided-qa-controller.js';
import { setCurrentProfileId } from '../profile/current.js';

describe('GuidedQaController', () => {
  beforeEach(() => {
    setCurrentProfileId('yassir-halal');
  });

  test('opens workflow selection for manual guided mode', () => {
    const controller = new GuidedQaController(() => {});

    const started = controller.startSession('', { manual: true });

    expect(started).toBe(true);
    expect(controller.state.appState).toBe('workflow_select');
    expect(controller.state.workflows.length).toBeGreaterThan(0);
  });

  test('stores a seeded workflow without forcing questions', () => {
    const controller = new GuidedQaController(() => {});

    const started = controller.startSession('MSFT', {
      workflowId: 'single_asset_review',
      manual: true,
    });

    expect(started).toBe(true);
    expect(controller.state.seedWorkflow?.id).toBe('single_asset_review');
    expect(controller.state.appState).toBe('idle');
  });

  test('tracks inline clarification answers and builds run context', () => {
    const controller = new GuidedQaController(() => {});

    controller.startSession('MSFT', { workflowId: 'single_asset_review', autoTriggered: true });
    controller.setPendingPrompt({
      question: 'Which verdict style should be emphasized?',
      label: 'Methodology priority',
      mode: 'inline',
    });

    expect(controller.isAwaitingInline()).toBe(true);

    controller.recordInlineAnswer('strictest');

    const context = controller.buildRunContext();

    expect(context?.seedWorkflowId).toBe('single_asset_review');
    expect(context?.entries).toEqual([{ label: 'Methodology priority', value: 'strictest' }]);
    expect(context?.enrichedQuery).toContain('Requested workflow: Single-Asset Review');
    expect(context?.enrichedQuery).toContain('Methodology priority: strictest');
    expect(context?.enrichedQuery).toContain('Expected output: Final verdict');
  });

  test('formats structured choices using labels', () => {
    const controller = new GuidedQaController(() => {});

    controller.startSession('ASML', { workflowId: 'single_asset_review' });
    controller.setPendingPrompt({
      question: 'Choose a deliverable.',
      label: 'Deliverable',
      mode: 'single_select',
      options: [
        { value: 'memo', label: 'Investment memo' },
        { value: 'table', label: 'Benchmark table' },
      ],
    });

    controller.recordStructuredAnswer('memo');

    expect(controller.getSummaryEntries()).toEqual([{ label: 'Deliverable', value: 'Investment memo' }]);
  });
});
