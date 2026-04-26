import { Hono } from 'hono';
import packageJson from '../../../package.json';

const health = new Hono();

const startTime = Date.now();

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    version: packageJson.version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

export { health };
