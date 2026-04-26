import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { chat } from './routes/chat.js';
import { profiles } from './routes/profiles.js';
import { health } from './routes/health.js';
import { commands } from './routes/commands.js';
import { models } from './routes/models.js';
import { workspaces } from './routes/workspaces.js';
import { guidedQa } from './routes/guided-qa.js';
import { sessions } from './routes/sessions.js';
import { keys } from './routes/keys.js';
import { auth } from './routes/auth.js';
import { accessCodeAuth } from './middleware/auth.js';

export function createApp(): Hono {
  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', logger());
  app.use('/api/*', accessCodeAuth);

  // API routes
  app.route('/api', auth);
  app.route('/api', health);
  app.route('/api', profiles);
  app.route('/api', chat);
  app.route('/api', commands);
  app.route('/api', models);
  app.route('/api', workspaces);
  app.route('/api', guidedQa);
  app.route('/api', sessions);
  app.route('/api', keys);

  // Static files (React build) in production
  app.use('/*', serveStatic({ root: './web/dist' }));
  app.get('/*', serveStatic({ root: './web/dist', path: 'index.html' }));

  return app;
}
