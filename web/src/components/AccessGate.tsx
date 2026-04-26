import { useState, useEffect, useCallback, type ReactNode, type FormEvent } from 'react';
import { checkAuthRequired, verifyCode, storeCode, getStoredCode, clearCode, installAuthInterceptor } from '../api/auth';

type GateState = 'loading' | 'open' | 'locked' | 'authenticated';

export function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('loading');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Install the fetch interceptor once
    installAuthInterceptor();

    checkAuthRequired().then(async (required) => {
      if (!required) {
        setState('open');
        return;
      }

      // If we have a stored code, verify it's still valid
      const stored = getStoredCode();
      if (stored) {
        const valid = await verifyCode(stored);
        if (valid) {
          setState('authenticated');
          return;
        }
        clearCode();
      }

      setState('locked');
    }).catch(() => {
      // If server is unreachable, show lock screen
      setState('locked');
    });
  }, []);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || checking) return;

    setChecking(true);
    setError('');

    try {
      const valid = await verifyCode(code.trim());
      if (valid) {
        storeCode(code.trim());
        setState('authenticated');
      } else {
        setError('Invalid access code');
        setCode('');
      }
    } catch {
      setError('Unable to reach server');
    } finally {
      setChecking(false);
    }
  }, [code, checking]);

  if (state === 'loading') {
    return (
      <div className="access-gate">
        <div className="access-gate-card">
          <div className="access-gate-spinner" />
        </div>
      </div>
    );
  }

  if (state === 'open' || state === 'authenticated') {
    return <>{children}</>;
  }

  // Locked state — show access code form
  return (
    <div className="access-gate">
      <form className="access-gate-card" onSubmit={handleSubmit}>
        <div className="access-gate-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="access-gate-title">Yassir</h2>
        <p className="access-gate-subtitle">Enter access code to continue</p>
        <input
          type="password"
          className="access-gate-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          autoFocus
          autoComplete="off"
          disabled={checking}
        />
        {error && <p className="access-gate-error">{error}</p>}
        <button
          type="submit"
          className="access-gate-btn"
          disabled={!code.trim() || checking}
        >
          {checking ? 'Verifying...' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
