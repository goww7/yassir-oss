import { config } from 'dotenv';
config({ quiet: true });

import { createApp } from './server.js';

const app = createApp();
const port = parseInt(process.env.PORT ?? '3000', 10);

console.log(`Yassir Web API starting on http://localhost:${port}`);

export default {
  fetch: app.fetch,
  port,
};
