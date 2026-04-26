import { Hono } from 'hono';

const auth = new Hono();

/**
 * POST /auth/verify  { code: string }
 * Returns { valid: true } or 401.
 * If YASSIR_ACCESS_CODE is unset, always returns { valid: true, open: true }.
 */
auth.post('/auth/verify', async (c) => {
  const accessCode = process.env.YASSIR_ACCESS_CODE;

  if (!accessCode) {
    return c.json({ valid: true, open: true });
  }

  const body = await c.req.json<{ code?: string }>();

  if (body.code === accessCode) {
    return c.json({ valid: true });
  }

  return c.json({ error: 'Invalid access code' }, 401);
});

/**
 * GET /auth/status
 * Returns whether auth is required (so the frontend knows to show the gate).
 */
auth.get('/auth/status', async (c) => {
  const accessCode = process.env.YASSIR_ACCESS_CODE;
  return c.json({ required: !!accessCode });
});

export { auth };
