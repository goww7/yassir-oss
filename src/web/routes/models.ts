import { Hono } from 'hono';
import { checkApiKeyExists } from '../../utils/env.js';

const models = new Hono();

interface ProviderInfo {
  id: string;
  displayName: string;
  envVar: string;
  models: Array<{ id: string; displayName: string }>;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai', displayName: 'OpenAI', envVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.4', displayName: 'GPT 5.4' },
      { id: 'gpt-4.1', displayName: 'GPT 4.1' },
      { id: 'gpt-5-mini', displayName: 'GPT 5 Mini' },
      { id: 'o4-mini', displayName: 'o4 Mini' },
    ],
  },
  {
    id: 'anthropic', displayName: 'Anthropic', envVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4' },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'google', displayName: 'Google', envVar: 'GOOGLE_API_KEY',
    models: [
      { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    ],
  },
  {
    id: 'xai', displayName: 'xAI', envVar: 'XAI_API_KEY',
    models: [
      { id: 'grok-3', displayName: 'Grok 3' },
      { id: 'grok-3-mini', displayName: 'Grok 3 Mini' },
    ],
  },
  {
    id: 'deepseek', displayName: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY',
    models: [
      { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
    ],
  },
  {
    id: 'ollama', displayName: 'Ollama (Local)', envVar: 'OLLAMA_BASE_URL',
    models: [
      { id: 'llama3.1', displayName: 'Llama 3.1' },
      { id: 'mistral', displayName: 'Mistral' },
      { id: 'qwen2.5', displayName: 'Qwen 2.5' },
    ],
  },
];

let currentModel = process.env.DEFAULT_MODEL ?? 'gpt-5.4';
let currentProvider = 'openai';

models.get('/models', (c) => {
  return c.json({
    currentModel,
    currentProvider,
    providers: PROVIDERS.map((p) => ({
      ...p,
      hasApiKey: p.envVar === 'OLLAMA_BASE_URL' ? true : checkApiKeyExists(p.envVar),
    })),
  });
});

models.put('/model', async (c) => {
  const body = await c.req.json<{ provider: string; modelId: string }>();
  if (!body.provider || !body.modelId) return c.json({ error: 'provider and modelId required' }, 400);
  currentProvider = body.provider;
  currentModel = body.modelId;
  return c.json({ provider: currentProvider, model: currentModel });
});

export { models };
