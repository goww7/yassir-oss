import { checkApiKeyExists } from './utils/env.js';
import { getCurrentProfile } from './profile/current.js';

export interface RuntimeIndexSuggestion {
  name: string;
  description?: string;
}

export interface RuntimeWatchlistSuggestion {
  id: string;
  name: string;
  count?: number;
}

const REFRESH_INTERVAL_MS = 60_000;

export class RuntimeSuggestionStore {
  private bulkIndices: RuntimeIndexSuggestion[] = [];
  private watchlists: RuntimeWatchlistSuggestion[] = [];
  private refreshTimer: Timer | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    this.refreshInBackground();
    this.refreshTimer = setInterval(() => {
      void this.refreshInBackground();
    }, REFRESH_INTERVAL_MS);
  }

  dispose() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getBulkIndices(): RuntimeIndexSuggestion[] {
    return [...this.bulkIndices];
  }

  getWatchlists(): RuntimeWatchlistSuggestion[] {
    return [...this.watchlists];
  }

  refreshInBackground(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refresh() {
    const currentProfile = getCurrentProfile();
    const backend = currentProfile.vertical.backend;
    if (!backend?.runtimeSuggestionsBaseUrl || !checkApiKeyExists(backend.envVar)) {
      this.bulkIndices = [];
      this.watchlists = [];
      return;
    }

    const apiKey = process.env[backend.envVar] || '';
    const [indices, watchlists] = await Promise.allSettled([
      this.fetchBulkIndices(apiKey, backend.runtimeSuggestionsBaseUrl),
      this.fetchWatchlists(apiKey, backend.runtimeSuggestionsBaseUrl),
    ]);

    if (indices.status === 'fulfilled') {
      this.bulkIndices = indices.value;
    }
    if (watchlists.status === 'fulfilled') {
      this.watchlists = watchlists.value;
    }
  }

  private async fetchBulkIndices(apiKey: string, baseUrl: string): Promise<RuntimeIndexSuggestion[]> {
    const response = await fetch(`${baseUrl}/api/screen-bulk/indices`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!response.ok) {
      throw new Error(`Bulk indices failed: ${response.status}`);
    }
    const data = (await response.json()) as { indices?: Array<{ name?: string; description?: string }> };
    return (data.indices ?? [])
      .filter((entry) => typeof entry.name === 'string' && entry.name.trim())
      .map((entry) => ({
        name: entry.name!.trim(),
        description: entry.description,
      }));
  }

  private async fetchWatchlists(apiKey: string, baseUrl: string): Promise<RuntimeWatchlistSuggestion[]> {
    const response = await fetch(`${baseUrl}/api/watchlists`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!response.ok) {
      throw new Error(`Watchlists failed: ${response.status}`);
    }
    const data = (await response.json()) as Array<{ id?: string; name?: string; count?: number }>;
    return (data ?? [])
      .filter((entry) => typeof entry.id === 'string' && entry.id.trim())
      .map((entry) => ({
        id: entry.id!.trim(),
        name: typeof entry.name === 'string' ? entry.name : entry.id!.trim(),
        count: typeof entry.count === 'number' ? entry.count : undefined,
      }));
  }
}
