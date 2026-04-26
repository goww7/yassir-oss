export type HalalTerminalBackend = 'api' | 'mcp' | 'hybrid';

export type HalalTerminalQueryParams = Record<string, string | number | boolean | undefined>;

export interface HalalTerminalRequestOptions {
  params?: HalalTerminalQueryParams;
  body?: Record<string, unknown>;
  apiKey?: string;
  responseType?: 'json' | 'text';
}

export interface HalalTerminalResponse {
  data: unknown;
  url: string;
  backend: Exclude<HalalTerminalBackend, 'hybrid'>;
  attemptedBackends: Array<Exclude<HalalTerminalBackend, 'hybrid'>>;
}
