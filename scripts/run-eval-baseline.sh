#!/usr/bin/env bash
# Run eval baseline with multi-dimensional scoring.
# Requires: OPENAI_API_KEY and LANGSMITH_API_KEY in .env
#
# Usage:
#   ./scripts/run-eval-baseline.sh           # Full run with scorer
#   ./scripts/run-eval-baseline.sh 5         # Sample of 5 questions
#   ./scripts/run-eval-baseline.sh 10 quick  # Sample of 10, correctness only (no multi-dim)

set -euo pipefail

SAMPLE_SIZE="${1:-}"
MODE="${2:-scorer}"

ARGS=""
if [ -n "$SAMPLE_SIZE" ]; then
  ARGS="--sample $SAMPLE_SIZE"
fi

if [ "$MODE" = "scorer" ]; then
  ARGS="$ARGS --scorer"
fi

echo "Running eval baseline..."
echo "  Sample: ${SAMPLE_SIZE:-all}"
echo "  Scorer: ${MODE}"
echo ""

exec bun run src/evals/run.ts $ARGS
