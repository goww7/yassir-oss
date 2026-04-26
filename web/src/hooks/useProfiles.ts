import { useState, useEffect, useCallback } from 'react';
import { fetchProfiles } from '../api/client';
import type { Profile, ProfilePalette } from '../types';

function applyPalette(palette: ProfilePalette) {
  const root = document.documentElement;
  const isLight = root.dataset.theme === 'light' || localStorage.getItem('yassir-theme') === 'light';
  // Brand colors apply in both themes
  root.style.setProperty('--primary', palette.primary);
  root.style.setProperty('--primary-light', palette.primaryLight);
  root.style.setProperty('--accent', palette.accent);
  root.style.setProperty('--info', palette.info);
  // Status colors — darken for light mode readability
  if (isLight) {
    root.style.setProperty('--success', palette.success === '#10b981' ? '#059669' : palette.success);
    root.style.setProperty('--error', palette.error === 'red' ? '#dc2626' : palette.error);
    root.style.setProperty('--warning', palette.warning === 'yellow' ? '#d97706' : palette.warning);
  } else {
    root.style.setProperty('--success', palette.success);
    root.style.setProperty('--error', palette.error);
    root.style.setProperty('--warning', palette.warning);
    // Dark-mode only: use palette text values
    root.style.setProperty('--text-muted', palette.muted);
    root.style.setProperty('--border', palette.border);
    root.style.setProperty('--white', palette.white);
  }
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [hasBackend, setHasBackend] = useState(false);
  const [version, setVersion] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfiles();
      setProfiles(data.profiles);
      setHasBackend(data.hasBackend);
      setVersion(data.version);
      setModel(data.model);
      const current = data.profiles[0];
      if (current?.palette) applyPalette(current.palette);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = profiles[0];

  return { current, hasBackend, version, model, loading, error, retry: load };
}
