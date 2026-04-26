import { Hono } from 'hono';
import { resolveSlashCommand, createSlashCommands, extractRecentSymbols } from '../../cli-slash-commands.js';
import { hasCurrentProfileBackendConfigured } from '../../profile/current.js';

const commands = new Hono();

commands.get('/slash-commands', (c) => {
  const cmds = createSlashCommands({
    getRecentSymbols: () => extractRecentSymbols([]),
    getBulkIndices: () => [],
    getWatchlists: () => [],
  });
  return c.json({
    commands: cmds.map((cmd) => ({ name: cmd.name, description: cmd.description })),
  });
});

commands.post('/slash-command', async (c) => {
  const body = await c.req.json<{ input: string; model?: string; provider?: string }>();
  if (!body.input) return c.json({ error: 'input required' }, 400);

  const context = {
    model: body.model ?? process.env.DEFAULT_MODEL ?? 'gpt-5.4',
    provider: body.provider ?? 'openai',
    providerLabel: (body.provider ?? 'openai').charAt(0).toUpperCase() + (body.provider ?? 'openai').slice(1),
    hasHalalBackend: hasCurrentProfileBackendConfigured(),
    configuredServices: [
      { label: 'Current provider key', configured: true },
      { label: 'Search', configured: Boolean(process.env.BRAVE_SEARCH_API_KEY || process.env.EXASEARCH_API_KEY || process.env.TAVILY_API_KEY || process.env.PERPLEXITY_API_KEY) },
      { label: 'X / Twitter', configured: Boolean(process.env.X_BEARER_TOKEN) },
    ],
  };

  const result = resolveSlashCommand(body.input, context);
  return c.json(result);
});

export { commands };
