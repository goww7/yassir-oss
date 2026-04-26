// Ported from src/utils/tool-source-drilldown.ts

export interface ToolSourceEntry {
  label: string;
  url?: string;
  meta?: string;
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const lastSpace = value.lastIndexOf(' ', maxLength);
  if (lastSpace > maxLength * 0.5) return `${value.slice(0, lastSpace)}...`;
  return `${value.slice(0, maxLength - 3)}...`;
}

function hostnameFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

export function extractToolSourceEntries(tool: string, rawResult: string): ToolSourceEntry[] {
  let parsed: { data?: Record<string, unknown>; sourceUrls?: string[] } | null;
  try { parsed = JSON.parse(rawResult); } catch { return []; }
  if (!parsed) return [];

  const entries: ToolSourceEntry[] = [];
  const recovery = parsed.data?._workflow && typeof parsed.data._workflow === 'object'
    ? (parsed.data._workflow as { recovery?: { dashboardUrl?: string } }).recovery
    : undefined;
  const results = Array.isArray(parsed.data?.results) ? parsed.data!.results : [];

  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const item = result as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url : undefined;
    const labelBase = typeof item.title === 'string' && item.title.trim()
      ? item.title.trim()
      : url ? hostnameFromUrl(url) : tool;
    const metaParts = [
      typeof item.provider === 'string' ? item.provider : null,
      typeof item.domain === 'string' ? item.domain : null,
      typeof item.score === 'number' ? `score ${item.score.toFixed(2)}` : null,
    ].filter(Boolean) as string[];
    entries.push({ label: truncateAtWord(labelBase, 80), url, meta: metaParts.length ? metaParts.join(' · ') : undefined });
  }

  if (entries.length > 0) return dedup(entries);

  if (tool === 'get_shariah' && typeof recovery?.dashboardUrl === 'string') {
    entries.push({
      label: 'Halal Terminal Dashboard',
      url: recovery.dashboardUrl,
      meta: 'account access',
    });
  }

  const sourceUrls = Array.isArray(parsed.sourceUrls) ? parsed.sourceUrls : [];
  for (const url of sourceUrls) {
    if (typeof url === 'string' && url.trim()) entries.push({ label: hostnameFromUrl(url), url });
  }
  return dedup(entries);
}

function dedup(entries: ToolSourceEntry[]): ToolSourceEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.url ?? ''}|${e.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
