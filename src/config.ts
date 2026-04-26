/**
 * Centralized configuration constants for the Yassir agent platform.
 *
 * Previously these values were scattered as magic numbers across modules.
 * Collect them here so they can be tuned from a single location and,
 * eventually, overridden via environment variables or a config file.
 */

// ============================================================================
// Agent Loop
// ============================================================================

/** Default LLM model used when none is specified. */
export const DEFAULT_MODEL = process.env.YASSIR_DEFAULT_MODEL ?? 'gpt-5.5';

/** Default LLM provider. */
export const DEFAULT_PROVIDER = process.env.YASSIR_DEFAULT_PROVIDER ?? 'openai';

/** Maximum ReAct iterations before the agent gives up. */
export const DEFAULT_MAX_ITERATIONS = Number(process.env.YASSIR_MAX_ITERATIONS) || 10;

/** Retries when context overflow is detected mid-run. */
export const MAX_OVERFLOW_RETRIES = 2;

/** Tool results to keep during an overflow-triggered clear. */
export const OVERFLOW_KEEP_TOOL_USES = 3;

// ============================================================================
// Context / Token Management
// ============================================================================

/** Maximum token budget for context data. */
export const TOKEN_BUDGET = 150_000;

/** Token count that triggers automatic context clearing. */
export const CONTEXT_THRESHOLD = 100_000;

/** Most recent tool results preserved when clearing context. */
export const KEEP_TOOL_USES = 5;

/** Characters-per-token ratio used for estimation (conservative). */
export const CHARS_PER_TOKEN = 3.5;

// ============================================================================
// Tool Limits (Scratchpad)
// ============================================================================

/** Default max calls per tool per query. */
export const MAX_CALLS_PER_TOOL = 3;

/** Jaccard similarity threshold for duplicate query detection (0-1). */
export const QUERY_SIMILARITY_THRESHOLD = 0.7;

// ============================================================================
// LLM Retry
// ============================================================================

/** Max retry attempts for transient LLM errors. */
export const LLM_MAX_RETRY_ATTEMPTS = 3;

// ============================================================================
// Progress Synthesis
// ============================================================================

/** Emit a progress update every N tool calls. */
export const PROGRESS_SYNTHESIS_INTERVAL = 4;

/** Max characters of tool result to include in synthesis input. */
export const PROGRESS_SYNTHESIS_TRUNCATE_CHARS = 6_000;

// ============================================================================
// Research Plan
// ============================================================================

/** Minimum word count to trigger research planning. */
export const PLAN_MIN_WORD_COUNT = 8;
