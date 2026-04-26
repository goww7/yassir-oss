/**
 * Token estimation utilities for context management.
 * Used to prevent exceeding LLM context window limits.
 *
 * Constants are defined in src/config.ts and re-exported here
 * for backward compatibility with existing imports.
 */

export {
  TOKEN_BUDGET,
  CONTEXT_THRESHOLD,
  KEEP_TOOL_USES,
  CHARS_PER_TOKEN,
} from '../config.js';

import { CHARS_PER_TOKEN } from '../config.js';

/**
 * Rough token estimation based on character count.
 * JSON is denser than prose, so we use ~3.5 chars per token.
 * This is conservative - better to underestimate available space.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
