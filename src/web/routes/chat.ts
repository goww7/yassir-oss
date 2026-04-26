import { Hono } from 'hono';
import { Agent } from '../../agent/agent.js';
import type { ApprovalDecision, AgentEvent } from '../../agent/types.js';
import { getOrCreateSession, getSession } from '../sessions.js';
import { formatSSE, formatSSEComment } from '../sse.js';
import { saveMessage } from '../session-store.js';

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const chat = new Hono();

chat.post('/chat', async (c) => {
  const body = await c.req.json<{
    sessionId: string;
    query: string;
    model?: string;
    profileId?: string;
  }>();

  if (!body.sessionId || !body.query) {
    return c.json({ error: 'sessionId and query are required' }, 400);
  }

  const session = getOrCreateSession(body.sessionId);

  // Abort any previous run
  session.abortController?.abort();
  const abortController = new AbortController();
  session.abortController = abortController;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Stream closed
        }
      };

      write(formatSSEComment('connected'));
      const allEvents: AgentEvent[] = [];

      try {
        const agent = await Agent.create({
          model: body.model,
          channel: 'web',
          signal: abortController.signal,
          requestToolApproval: async (request) => {
            session.pendingApproval = {
              tool: request.tool,
              args: request.args,
              resolve: null as unknown as (d: ApprovalDecision) => void,
            };

            // Push approval request to client
            write(formatSSE({
              type: 'tool_approval_request',
              tool: request.tool,
              args: request.args,
            }));

            // Wait for client to POST /api/chat/:id/approve
            return new Promise<ApprovalDecision>((resolve) => {
              session.pendingApproval!.resolve = resolve;

              // Auto-deny after timeout
              setTimeout(() => {
                if (session.pendingApproval?.resolve === resolve) {
                  session.pendingApproval = null;
                  resolve('deny');
                }
              }, APPROVAL_TIMEOUT_MS);
            });
          },
          sessionApprovedTools: session.sessionApprovedTools,
        });

        for await (const event of agent.run(body.query, session.history)) {
          if (abortController.signal.aborted) break;
          write(formatSSE(event));

          if (event.type === 'done') {
            session.history.saveUserQuery(body.query);
            session.history.saveAnswer(event.answer).catch(() => {});
            // Persist to SQLite
            saveMessage(body.sessionId, 'user', body.query);
            saveMessage(body.sessionId, 'assistant', event.answer, allEvents);
          }
          allEvents.push(event);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (!abortController.signal.aborted) {
          write(formatSSE({ type: 'error', error: message }));
        }
      } finally {
        session.abortController = null;
        session.pendingApproval = null;
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

chat.post('/chat/:sessionId/approve', async (c) => {
  const { sessionId } = c.req.param();
  const body = await c.req.json<{ decision: ApprovalDecision }>();

  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  if (!session.pendingApproval) {
    return c.json({ error: 'No pending approval' }, 400);
  }

  const decision = body.decision ?? 'deny';
  session.pendingApproval.resolve(decision);
  session.pendingApproval = null;

  return c.json({ ok: true, decision });
});

chat.post('/chat/:sessionId/abort', (c) => {
  const { sessionId } = c.req.param();
  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  session.abortController?.abort();
  return c.json({ ok: true });
});

export { chat };
