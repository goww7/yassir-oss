import { checkApiKeyExists, saveApiKeyToEnv } from '../utils/env.js';
import { getCurrentProfile } from '../profile/current.js';

/** FastAPI / similar JSON error bodies: `{ message }`, `{ detail: string }`, or `{ detail: [{ msg }] }`. */
function formatHttpJsonError(body: unknown, fallback: string): string {
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

/** Enough for preflight; Halal Terminal uses strict server-side email validation. */
function isPlausibleSignupEmail(email: string): boolean {
  const i = email.indexOf('@');
  if (i <= 0) return false;
  const local = email.slice(0, i);
  const domain = email.slice(i + 1);
  if (!local.length || !domain.length) return false;
  return domain.includes('.') || domain === 'localhost';
}

export type HalalKeyState =
  | 'confirm'      // Ask user if they want to set up Halal Terminal
  | 'email_input'  // Ask for email address
  | 'generating'   // API call in progress
  | 'done'         // Key saved successfully
  | 'error'        // API call failed
  | 'skipped';     // User declined

export interface HalalKeyControllerState {
  appState: HalalKeyState;
  errorMessage?: string;
  generatedKey?: string;
}

export class HalalKeyController {
  private _state: HalalKeyControllerState = { appState: 'skipped' };
  private readonly onUpdate: () => void;
  private readonly profile = getCurrentProfile();

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  /** Returns true if setup is needed and the wizard should be shown. */
  startIfNeeded(): boolean {
    const backend = this.profile.vertical.backend;
    if (!backend?.setup || checkApiKeyExists(backend.envVar)) {
      return false;
    }
    this._state = { appState: 'confirm' };
    return true;
  }

  get state(): HalalKeyControllerState {
    return this._state;
  }

  /** Whether the wizard is active (not yet skipped, errored-out, or done). */
  isActive(): boolean {
    return this._state.appState === 'confirm'
      || this._state.appState === 'email_input'
      || this._state.appState === 'generating';
  }

  /** User chose Yes/No on the confirm screen. */
  handleConfirm(wantsToSetUp: boolean): void {
    if (!wantsToSetUp) {
      this._state = { appState: 'skipped' };
    } else {
      this._state = { appState: 'email_input' };
    }
    this.onUpdate();
  }

  /** User submitted their email (null = cancelled). */
  async handleEmailSubmit(email: string | null): Promise<void> {
    const backend = this.profile.vertical.backend;
    const setup = backend?.setup;
    const trimmed = email?.trim() ?? '';
    if (!trimmed) {
      this._state = { appState: 'skipped' };
      this.onUpdate();
      return;
    }

    if (!isPlausibleSignupEmail(trimmed)) {
      this._state = {
        appState: 'error',
        errorMessage:
          'Enter a valid email (e.g. you@gmail.com). It must include @ and a domain such as .com.',
      };
      this.onUpdate();
      return;
    }

    this._state = { appState: 'generating' };
    this.onUpdate();

    try {
      if (!backend || !setup) {
        throw new Error('No profile backend setup is configured.');
      }

      const response = await fetch(setup.generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const fallback = `${response.status} ${response.statusText}`;
        const detail = formatHttpJsonError(body, fallback);
        throw new Error(detail);
      }

      const data = await response.json() as { api_key: string };
      const apiKey = data.api_key;

      saveApiKeyToEnv(backend.envVar, apiKey);

      this._state = { appState: 'done', generatedKey: apiKey };
      this.onUpdate();
    } catch (err) {
      this._state = {
        appState: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
      this.onUpdate();
    }
  }

  /** Dismiss error and return to email input to retry. */
  retryFromError(): void {
    this._state = { appState: 'email_input' };
    this.onUpdate();
  }

  /** Dismiss done/error screen and continue to main app. */
  dismiss(): void {
    this._state = { appState: 'skipped' };
    this.onUpdate();
  }
}
