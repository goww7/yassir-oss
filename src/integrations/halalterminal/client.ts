import { logger } from '../../utils/logger.js';
import type {
  HalalTerminalBackend,
  HalalTerminalQueryParams,
  HalalTerminalRequestOptions,
  HalalTerminalResponse,
} from './types.js';

const API_BASE_URL = 'https://api.halalterminal.com';
const DASHBOARD_URL = 'https://api.halalterminal.com/dashboard/';

export function getHalalTerminalApiKey(): string {
  return process.env.HALAL_TERMINAL_API_KEY || '';
}

export function getHalalTerminalApiKeyOrThrow(): string {
  const apiKey = getHalalTerminalApiKey();
  if (!apiKey) {
    throw new Error('[Halal Terminal] HALAL_TERMINAL_API_KEY is not configured');
  }
  return apiKey;
}

export function getHalalTerminalDashboardUrl(): string {
  const apiKey = getHalalTerminalApiKey();
  if (!apiKey) return DASHBOARD_URL;

  const url = new URL(DASHBOARD_URL);
  // Keep the key out of HTTP requests and server logs. The dashboard can read
  // this fragment, store it as `ht_api_key`, and remove it from history.
  url.hash = `api_key=${encodeURIComponent(apiKey)}`;
  return url.toString();
}

export function getHalalTerminalBackendMode(): HalalTerminalBackend {
  const raw = (process.env.YASSIR_HALALTERMINAL_BACKEND ?? 'api').trim().toLowerCase();
  if (raw === 'api' || raw === 'mcp' || raw === 'hybrid') {
    return raw;
  }
  return 'api';
}

function hasConfiguredMcpBridge(): boolean {
  return process.env.YASSIR_HALALTERMINAL_MCP_ENABLED === '1';
}

function buildApiUrl(path: string, params: HalalTerminalQueryParams = {}): URL {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function parseErrorBody(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const parsed = (await response.json()) as Record<string, unknown>;
      const code = typeof parsed.code === 'string' ? parsed.code : null;
      const message = typeof parsed.message === 'string' ? parsed.message : null;
      const detail = parsed.detail !== undefined ? JSON.stringify(parsed.detail) : null;
      return [code, message, detail].filter(Boolean).join(' | ');
    }
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

async function apiRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: HalalTerminalRequestOptions = {},
): Promise<HalalTerminalResponse> {
  const resolvedKey = options.apiKey ?? getHalalTerminalApiKey();
  if (!resolvedKey) {
    logger.warn(`[Halal Terminal API] ${method} call without API key: ${path}`);
  }

  const url = buildApiUrl(path, options.params);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(resolvedKey ? { 'X-API-Key': resolvedKey } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    throw new Error(`[Halal Terminal API] network error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const detail = await parseErrorBody(response);
    throw new Error(
      `[Halal Terminal API] ${response.status} ${response.statusText} — ${path}${detail ? ` — ${detail}` : ''}`,
    );
  }

  const data = options.responseType === 'text' ? await response.text() : await response.json();
  return {
    data,
    url: url.toString(),
    backend: 'api',
    attemptedBackends: ['api'],
  };
}

async function mcpRequest(
  _method: 'GET' | 'POST' | 'DELETE',
  path: string,
): Promise<HalalTerminalResponse> {
  throw new Error(
    `[Halal Terminal MCP] requested for ${path}, but no runtime MCP bridge is configured. Set YASSIR_HALALTERMINAL_BACKEND=api or wire an MCP adapter into src/integrations/halalterminal/client.ts.`,
  );
}

export async function halalTerminalRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: HalalTerminalRequestOptions = {},
): Promise<HalalTerminalResponse> {
  const mode = getHalalTerminalBackendMode();

  if (mode === 'api') {
    return apiRequest(method, path, options);
  }

  if (mode === 'mcp') {
    return mcpRequest(method, path);
  }

  if (!hasConfiguredMcpBridge()) {
    return apiRequest(method, path, options);
  }

  try {
    const mcpResult = await mcpRequest(method, path);
    return {
      ...mcpResult,
      attemptedBackends: ['mcp'],
    };
  } catch (mcpError) {
    logger.debug(
      `[Halal Terminal] MCP bridge unavailable, falling back to API for ${path}: ${
        mcpError instanceof Error ? mcpError.message : String(mcpError)
      }`,
    );
  }

  const apiResult = await apiRequest(method, path, options);
  return {
    ...apiResult,
    attemptedBackends: ['mcp', 'api'],
  };
}

export async function halalTerminalGet(
  path: string,
  params: HalalTerminalQueryParams = {},
): Promise<HalalTerminalResponse> {
  return halalTerminalRequest('GET', path, { params });
}

export async function halalTerminalPost(
  path: string,
  body: Record<string, unknown>,
  params: HalalTerminalQueryParams = {},
): Promise<HalalTerminalResponse> {
  return halalTerminalRequest('POST', path, { body, params });
}

export async function halalTerminalDelete(path: string): Promise<HalalTerminalResponse> {
  return halalTerminalRequest('DELETE', path);
}

export async function halalTerminalText(path: string): Promise<HalalTerminalResponse> {
  return halalTerminalRequest('GET', path, { responseType: 'text' });
}
