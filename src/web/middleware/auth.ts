import { createMiddleware } from 'hono/factory';

/**
 * Lightweight access-code middleware.
 * If YASSIR_ACCESS_CODE is set, every /api request (except /health & /auth/*)
 * must include `Authorization: Bearer <code>`.
 * If the env var is unset, all requests pass through (no protection).
 */
export const accessCodeAuth = createMiddleware(async (c, next) => {
  const accessCode = process.env.YASSIR_ACCESS_CODE;

  // No code configured → open access (local dev)
  if (!accessCode) return next();

  const path = c.req.path;

  // Allow health and auth endpoints without auth
  if (path === '/api/health' || path.startsWith('/api/auth/')) return next();

  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (token !== accessCode) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
});
