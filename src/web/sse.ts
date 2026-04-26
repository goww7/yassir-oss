import type { AgentEvent } from '../agent/types.js';

export function formatSSE(event: AgentEvent | { type: string; [key: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function formatSSEComment(comment: string): string {
  return `: ${comment}\n\n`;
}
