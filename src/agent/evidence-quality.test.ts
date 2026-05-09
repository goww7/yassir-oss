/**
 * Regression test: ensures the Evidence Quality discipline block in
 * the agent's tool-usage policy isn't accidentally stripped.
 *
 * The block is what keeps yassir honest when HalalTerminal is degraded,
 * partial, or abstaining. Removing or rewording these bullets without
 * updating this test indicates a likely behavior regression.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const promptsPath = join(dirname(fileURLToPath(import.meta.url)), 'prompts.ts');
const promptsSource = readFileSync(promptsPath, 'utf8');

describe('agent prompts — evidence quality discipline', () => {
  test('verification labeling bullet exists', () => {
    expect(promptsSource).toContain('EVIDENCE QUALITY: when citing a methodology verdict');
  });

  test('abstain bullet exists', () => {
    expect(promptsSource).toContain('EVIDENCE QUALITY: when a result has app_compliance_status="abstain"');
  });

  test('degraded sources bullet exists', () => {
    expect(promptsSource).toContain('EVIDENCE QUALITY: when a result has degraded_sources');
  });

  test('staleness bullet exists', () => {
    expect(promptsSource).toContain('EVIDENCE QUALITY: when get_screening_staleness reports staleness=true');
  });

  test('no-data vs non-compliant distinction bullet exists', () => {
    expect(promptsSource).toContain('distinguish "no data" from "non-compliant"');
  });

  test('ETF handling bullet rejects boolean reduction', () => {
    expect(promptsSource).toContain('ETF HANDLING');
    expect(promptsSource).toContain('Never reduce ETF results to a boolean halal/not-halal');
  });

  test('proactive insights routing rules exist', () => {
    expect(promptsSource).toContain('INSIGHTS: after a screen returning COMPLIANT with marginal ratios');
    expect(promptsSource).toContain('INSIGHTS: after a NON_COMPLIANT verdict on a candidate');
  });
});
