export type ToolSourceEntry = {
  label: string;
  url?: string;
  meta?: string;
};

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const lastSpace = value.lastIndexOf(' ', maxLength);
  if (lastSpace > maxLength * 0.5) {
    return `${value.slice(0, lastSpace)}...`;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function parseResult(raw: string): { data?: Record<string, unknown>; sourceUrls?: string[] } | null {
  try {
    return JSON.parse(raw) as { data?: Record<string, unknown>; sourceUrls?: string[] };
  } catch {
    return null;
  }
}

export function extractToolSourceEntries(tool: string, rawResult: string): ToolSourceEntry[] {
  const parsed = parseResult(rawResult);
  if (!parsed) {
    return [];
  }

  const entries: ToolSourceEntry[] = [];
  const recovery =
    parsed.data?._workflow && typeof parsed.data._workflow === 'object'
      ? (parsed.data._workflow as { recovery?: { dashboardUrl?: string } }).recovery
      : undefined;
  const results = Array.isArray(parsed.data?.results) ? parsed.data.results : [];

  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const item = result as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url : undefined;
    const labelBase =
      typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : url
          ? hostnameFromUrl(url)
          : tool;
    const metaParts = [
      typeof item.provider === 'string' ? item.provider : null,
      typeof item.domain === 'string' ? item.domain : null,
      typeof item.score === 'number' ? `score ${item.score.toFixed(2)}` : null,
    ].filter(Boolean) as string[];
    entries.push({
      label: truncateAtWord(labelBase, 80),
      url,
      meta: metaParts.length ? metaParts.join(' · ') : undefined,
    });
  }

  if (entries.length > 0) {
    return dedupeEntries(entries);
  }

  if (tool === 'get_shariah' && typeof recovery?.dashboardUrl === 'string') {
    entries.push({
      label: 'Refill or upgrade HalalTerminal credits',
      url: recovery.dashboardUrl,
      meta: 'action required',
    });
  }

  const sourceUrls = Array.isArray(parsed.sourceUrls) ? parsed.sourceUrls : [];
  for (const url of sourceUrls) {
    if (typeof url !== 'string' || !url.trim()) continue;
    entries.push({
      label: hostnameFromUrl(url),
      url,
    });
  }

  return dedupeEntries(entries);
}

function dedupeEntries(entries: ToolSourceEntry[]): ToolSourceEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.url ?? ''}|${entry.label}|${entry.meta ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
