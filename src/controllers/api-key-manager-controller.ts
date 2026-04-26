/**
 * ApiKeyManagerController — manages the in-app API key management flow.
 *
 * Triggered by the /keys command. Shows all configured and missing API keys
 * for LLM providers and data services, and lets the user add or update any key.
 *
 * Flow:
 *   1. provider_select — list of all keys with ✓/✗ status
 *   2. key_input       — text input for the selected key
 *   3. done            — brief confirmation before returning to list
 */

import { PROVIDERS } from '../providers.js';
import { getCurrentProfile } from '../profile/current.js';
import { checkApiKeyExists, saveApiKeyToEnv } from '../utils/env.js';

export interface ManagedKey {
  /** Label shown in the selector (e.g. "OpenAI") */
  label: string;
  /** The env var name (e.g. "OPENAI_API_KEY") */
  envVar: string;
  /** Whether a non-placeholder value is currently set */
  isSet: boolean;
}

export type ApiKeyManagerAppState = 'idle' | 'provider_select' | 'key_input' | 'done' | 'error';

export interface ApiKeyManagerState {
  appState: ApiKeyManagerAppState;
  keys: ManagedKey[];
  selectedKey: ManagedKey | null;
  savedKeyLabel: string | null;
  errorMessage?: string;
}

const EXTRA_KEYS: Array<{ label: string; envVar: string }> = [
  { label: 'Exa Search', envVar: 'EXASEARCH_API_KEY' },
  { label: 'Perplexity', envVar: 'PERPLEXITY_API_KEY' },
  { label: 'Tavily', envVar: 'TAVILY_API_KEY' },
  { label: 'Brave Search', envVar: 'BRAVE_SEARCH_API_KEY' },
  { label: 'X / Twitter', envVar: 'X_BEARER_TOKEN' },
];

function buildManagedKeys(): ManagedKey[] {
  const currentProfile = getCurrentProfile();
  const keys: ManagedKey[] = [];

  // LLM providers (skip Ollama — no API key)
  for (const provider of PROVIDERS) {
    if (!provider.apiKeyEnvVar) continue;
    keys.push({
      label: provider.displayName,
      envVar: provider.apiKeyEnvVar,
      isSet: checkApiKeyExists(provider.apiKeyEnvVar),
    });
  }

  if (currentProfile.vertical.backend) {
    keys.push({
      label: currentProfile.vertical.backend.label,
      envVar: currentProfile.vertical.backend.envVar,
      isSet: checkApiKeyExists(currentProfile.vertical.backend.envVar),
    });
  }

  // Data / search keys
  for (const extra of EXTRA_KEYS) {
    keys.push({
      label: extra.label,
      envVar: extra.envVar,
      isSet: checkApiKeyExists(extra.envVar),
    });
  }

  return keys;
}

export class ApiKeyManagerController {
  private _state: ApiKeyManagerState = {
    appState: 'idle',
    keys: [],
    selectedKey: null,
    savedKeyLabel: null,
  };
  private readonly onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  get state(): ApiKeyManagerState {
    return this._state;
  }

  isActive(): boolean {
    return this._state.appState !== 'idle';
  }

  /** Open the key manager — call when user types /keys */
  open(): void {
    this._state = {
      appState: 'provider_select',
      keys: buildManagedKeys(),
      selectedKey: null,
      savedKeyLabel: null,
    };
    this.onUpdate();
  }

  /** User selected a key from the list (null = cancel / close) */
  handleKeySelect(envVar: string | null): void {
    if (!envVar) {
      this._state = { ...this._state, appState: 'idle', selectedKey: null };
      this.onUpdate();
      return;
    }
    const key = this._state.keys.find((k) => k.envVar === envVar) ?? null;
    this._state = { ...this._state, appState: 'key_input', selectedKey: key };
    this.onUpdate();
  }

  /** User submitted a value in the key input (null = back to list) */
  async handleKeySubmit(value: string | null): Promise<void> {
    if (!value || !this._state.selectedKey) {
      // Go back to the list
      this._state = {
        ...this._state,
        appState: 'provider_select',
        keys: buildManagedKeys(),
        selectedKey: null,
        errorMessage: undefined,
      };
      this.onUpdate();
      return;
    }

    const selected = this._state.selectedKey;
    const label = selected.label;
    const trimmed = value.trim();

    try {
      if (selected.envVar === 'HALAL_TERMINAL_API_KEY' && trimmed.includes('@') && !trimmed.startsWith('ht_')) {
        const setupUrl = getCurrentProfile().vertical.backend?.setup?.generateUrl;
        if (!setupUrl) {
          throw new Error('No Halal Terminal generate endpoint is configured.');
        }
        const response = await fetch(setupUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmed }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(extractApiError(body, `${response.status} ${response.statusText}`));
        }
        const data = await response.json() as { api_key?: string };
        if (!data.api_key || !data.api_key.startsWith('ht_')) {
          throw new Error('Halal Terminal did not return a valid API key.');
        }
        saveApiKeyToEnv(selected.envVar, data.api_key);
      } else {
        saveApiKeyToEnv(selected.envVar, trimmed);
      }

      this._state = {
        ...this._state,
        appState: 'done',
        savedKeyLabel: label,
        selectedKey: null,
        errorMessage: undefined,
      };
      this.onUpdate();
    } catch (error) {
      this._state = {
        ...this._state,
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      this.onUpdate();
    }
  }

  /** Dismiss the "done" confirmation and return to the list */
  dismissDone(): void {
    this._state = {
      appState: 'provider_select',
      keys: buildManagedKeys(),
      selectedKey: null,
      savedKeyLabel: null,
      errorMessage: undefined,
    };
    this.onUpdate();
  }

  retryFromError(): void {
    this._state = {
      ...this._state,
      appState: 'key_input',
      errorMessage: undefined,
    };
    this.onUpdate();
  }

  /** Close the manager entirely */
  close(): void {
    this._state = {
      appState: 'idle',
      keys: [],
      selectedKey: null,
      savedKeyLabel: null,
      errorMessage: undefined,
    };
    this.onUpdate();
  }
}

function extractApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const o = body as Record<string, unknown>;
  if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
  const detail = o.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item) {
          const m = (item as { msg?: unknown }).msg;
          return typeof m === 'string' ? m : null;
        }
        return null;
      })
      .filter((s): s is string => Boolean(s && s.trim()));
    if (msgs.length) return msgs.join('; ');
  }
  return fallback;
}
