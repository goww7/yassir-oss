const STORAGE_KEY = 'yassir-access-code';

export function getStoredCode(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function storeCode(code: string): void {
  localStorage.setItem(STORAGE_KEY, code);
}

export function clearCode(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Check if the server requires an access code. */
export async function checkAuthRequired(): Promise<boolean> {
  const res = await fetch('/api/auth/status');
  const data = await res.json();
  return !!data.required;
}

/** Verify a code against the server. */
export async function verifyCode(code: string): Promise<boolean> {
  const res = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return res.ok;
}

/**
 * Install a global fetch interceptor that auto-injects the Authorization
 * header on all /api/ requests (except auth endpoints).
 * Call once at app startup.
 */
export function installAuthInterceptor(): void {
  const originalFetch = window.fetch.bind(window);

  const interceptedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    // Only inject on /api/ calls, skip auth endpoints (they don't need it)
    if (url.startsWith('/api/') && !url.includes('/api/auth/')) {
      const code = getStoredCode();
      if (code) {
        const headers = new Headers(init?.headers);
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${code}`);
        }
        return originalFetch(input, { ...init, headers });
      }
    }

    return originalFetch(input, init);
  };

  (window as any).fetch = interceptedFetch;
}
