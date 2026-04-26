import { formatToolResult } from '../types.js';

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': 'Yassir/2026 open-data tool',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => `${response.status} ${response.statusText}`);
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }

  return response.json() as Promise<T>;
}

export function finalizeOpenDataResult(data: unknown, urls: string[]): string {
  return formatToolResult(data, urls);
}
