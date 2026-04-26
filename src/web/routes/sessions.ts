import { Hono } from 'hono';
import { listSessions, getMessages, deleteSession as deleteStoredSession } from '../session-store.js';

const sessions = new Hono();

sessions.get('/sessions', (c) => {
  return c.json({ sessions: listSessions() });
});

sessions.get('/sessions/:id/messages', (c) => {
  const messages = getMessages(c.req.param('id'));
  return c.json({
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      events: JSON.parse(m.events || '[]'),
      timestamp: m.timestamp,
    })),
  });
});

sessions.delete('/sessions/:id', (c) => {
  deleteStoredSession(c.req.param('id'));
  return c.json({ ok: true });
});

export { sessions };
