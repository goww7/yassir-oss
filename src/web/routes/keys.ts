import { Hono } from 'hono';
import { checkApiKeyExists } from '../../utils/env.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { getHalalTerminalDashboardUrl } from '../../integrations/halalterminal/client.js';

const keys = new Hono();

const KEY_ENTRIES = [
  { envVar: 'OPENAI_API_KEY', label: 'OpenAI', group: 'LLM Providers' },
  { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic', group: 'LLM Providers' },
  { envVar: 'GOOGLE_API_KEY', label: 'Google', group: 'LLM Providers' },
  { envVar: 'XAI_API_KEY', label: 'xAI', group: 'LLM Providers' },
  { envVar: 'DEEPSEEK_API_KEY', label: 'DeepSeek', group: 'LLM Providers' },
  { envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter', group: 'LLM Providers' },
  { envVar: 'MOONSHOT_API_KEY', label: 'Moonshot', group: 'LLM Providers' },
  {
    envVar: 'HALAL_TERMINAL_API_KEY',
    label: 'Halal Terminal',
    group: 'Domain APIs',
    dashboardUrl: 'https://api.halalterminal.com/dashboard/',
    upgradeUrl: 'https://api.halalterminal.com/dashboard/',
    helperText: 'Refill credits, upgrade your plan, or check usage when live screening is blocked.',
  },
  { envVar: 'BRAVE_SEARCH_API_KEY', label: 'Brave Search', group: 'Search Providers' },
  { envVar: 'EXASEARCH_API_KEY', label: 'Exa Search', group: 'Search Providers' },
  { envVar: 'TAVILY_API_KEY', label: 'Tavily Search', group: 'Search Providers' },
  { envVar: 'PERPLEXITY_API_KEY', label: 'Perplexity', group: 'Search Providers' },
  { envVar: 'X_BEARER_TOKEN', label: 'X / Twitter', group: 'Social' },
  { envVar: 'SHODAN_API_KEY', label: 'Shodan', group: 'Security' },
  { envVar: 'VIRUSTOTAL_API_KEY', label: 'VirusTotal', group: 'Security' },
  { envVar: 'ABUSEIPDB_API_KEY', label: 'AbuseIPDB', group: 'Security' },
  { envVar: 'OTX_API_KEY', label: 'AlienVault OTX', group: 'Security' },
];

function validateKeyValue(envVar: string, rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return 'value is required';

  // Guard against accidentally saving terminal/UI text into API key fields.
  if (/error:\s*\d{3}/i.test(value) || /press enter to retry/i.test(value)) {
    return 'invalid key value';
  }

  if (envVar === 'HALAL_TERMINAL_API_KEY' && !/^ht_[a-zA-Z0-9_-]+$/.test(value)) {
    return 'invalid Halal Terminal API key format';
  }

  return null;
}

keys.get('/keys', (c) => {
  const entries = KEY_ENTRIES.map((entry) => ({
    ...entry,
    ...(entry.envVar === 'HALAL_TERMINAL_API_KEY'
      ? {
          dashboardUrl: getHalalTerminalDashboardUrl(),
          upgradeUrl: getHalalTerminalDashboardUrl(),
        }
      : {}),
    configured: checkApiKeyExists(entry.envVar),
    masked: process.env[entry.envVar] ? maskKey(process.env[entry.envVar]!) : null,
  }));

  const groups: Record<string, typeof entries> = {};
  for (const entry of entries) {
    if (!groups[entry.group]) groups[entry.group] = [];
    groups[entry.group].push(entry);
  }

  return c.json({ groups });
});

keys.put('/keys/:envVar', async (c) => {
  const { envVar } = c.req.param();
  const body = await c.req.json<{ value: string }>();
  const value = body.value?.trim() ?? '';

  const entry = KEY_ENTRIES.find((e) => e.envVar === envVar);
  if (!entry) return c.json({ error: `Unknown key: ${envVar}` }, 404);
  const validationError = validateKeyValue(envVar, value);
  if (validationError) return c.json({ error: validationError }, 400);

  // Set in current process
  process.env[envVar] = value;

  // Persist to .env file
  const envPath = resolve('.env');
  try {
    let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
    const regex = new RegExp(`^${envVar}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${envVar}=${value}`);
    } else {
      envContent += `\n${envVar}=${value}`;
    }
    writeFileSync(envPath, envContent, 'utf-8');
  } catch {
    // Still set in process.env even if .env write fails
  }

  return c.json({ ok: true, envVar, label: entry.label });
});

keys.delete('/keys/:envVar', (c) => {
  const { envVar } = c.req.param();
  const entry = KEY_ENTRIES.find((e) => e.envVar === envVar);
  if (!entry) return c.json({ error: `Unknown key: ${envVar}` }, 404);

  delete process.env[envVar];

  const envPath = resolve('.env');
  try {
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const nextContent = envContent
        .split(/\r?\n/)
        .filter((line) => !line.match(new RegExp(`^\\s*${envVar}\\s*=`)))
        .join('\n');
      writeFileSync(envPath, nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`, 'utf-8');
    }
  } catch {
    // The runtime key is still cleared even if .env cannot be updated.
  }

  return c.json({ ok: true, envVar, label: entry.label });
});

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

export { keys };
