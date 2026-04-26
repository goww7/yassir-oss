import { useState, useEffect } from 'react';

type Theme = 'dark' | 'light';

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('yassir-theme') as Theme | null;
    if (stored) return stored;
  } catch {}
  // P2: Detect system preference on first load
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (theme === 'light') {
    root.style.setProperty('--bg', '#f8f9fa');
    root.style.setProperty('--bg-surface', '#ffffff');
    root.style.setProperty('--bg-elevated', '#f1f3f5');
    root.style.setProperty('--bg-glass', 'rgba(255, 255, 255, 0.72)');
    root.style.setProperty('--bg-glass-heavy', 'rgba(255, 255, 255, 0.88)');
    root.style.setProperty('--bg-hover', 'rgba(0, 0, 0, 0.03)');
    root.style.setProperty('--bg-active', 'rgba(0, 0, 0, 0.05)');
    root.style.setProperty('--border', 'rgba(0, 0, 0, 0.08)');
    root.style.setProperty('--border-subtle', 'rgba(0, 0, 0, 0.04)');
    root.style.setProperty('--border-strong', 'rgba(0, 0, 0, 0.12)');
    root.style.setProperty('--text', '#1a1a2e');
    root.style.setProperty('--text-muted', '#6b7280');
    root.style.setProperty('--text-faint', '#9ca3af');
    root.style.setProperty('--white', '#111827');
    root.style.setProperty('--shadow-sm', '0 1px 2px rgba(0, 0, 0, 0.06)');
    root.style.setProperty('--shadow-md', '0 4px 16px rgba(0, 0, 0, 0.08)');
    root.style.setProperty('--shadow-lg', '0 8px 32px rgba(0, 0, 0, 0.12)');
  } else {
    root.style.setProperty('--bg', '#09090b');
    root.style.setProperty('--bg-surface', '#111113');
    root.style.setProperty('--bg-elevated', '#18181b');
    root.style.setProperty('--bg-glass', 'rgba(17, 17, 19, 0.72)');
    root.style.setProperty('--bg-glass-heavy', 'rgba(17, 17, 19, 0.88)');
    root.style.setProperty('--bg-hover', 'rgba(255, 255, 255, 0.04)');
    root.style.setProperty('--bg-active', 'rgba(255, 255, 255, 0.06)');
    root.style.setProperty('--border', 'rgba(255, 255, 255, 0.08)');
    root.style.setProperty('--border-subtle', 'rgba(255, 255, 255, 0.05)');
    root.style.setProperty('--border-strong', 'rgba(255, 255, 255, 0.12)');
    root.style.setProperty('--text', '#e4e4e7');
    root.style.setProperty('--text-muted', '#71717a');
    root.style.setProperty('--text-faint', '#52525b');
    root.style.setProperty('--white', '#fafafa');
    root.style.setProperty('--shadow-sm', '0 1px 2px rgba(0, 0, 0, 0.3)');
    root.style.setProperty('--shadow-md', '0 4px 16px rgba(0, 0, 0, 0.4)');
    root.style.setProperty('--shadow-lg', '0 8px 32px rgba(0, 0, 0, 0.5)');
  }
  try { localStorage.setItem('yassir-theme', theme); } catch {}
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  return (
    <button
      className="theme-toggle"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
