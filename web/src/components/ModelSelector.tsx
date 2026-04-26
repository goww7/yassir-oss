import { useState, useEffect } from 'react';

interface ProviderInfo {
  id: string;
  displayName: string;
  hasApiKey: boolean;
  models: Array<{ id: string; displayName: string }>;
}

interface Props {
  onClose: () => void;
  onSelect: (provider: string, modelId: string, displayName: string) => void;
}

export function ModelSelector({ onClose, onSelect }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(null);

  useEffect(() => {
    fetch('/api/models').then((r) => r.json()).then((data) => {
      setProviders(data.providers);
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (selectedProvider) {
    return (
      <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Select model">
        <div className="modal-terminal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-title">
            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>Provider /</span> {selectedProvider.displayName}
          </div>
          <div className="separator" aria-hidden="true" />
          <div className="modal-options">
            {selectedProvider.models.map((m) => (
              <button key={m.id} className="modal-option" onClick={() => onSelect(selectedProvider.id, m.id, m.displayName)}>
                <span className="option-arrow">&#x2192;</span>
                <span>{m.displayName}</span>
                <span className="option-meta">{m.id}</span>
              </button>
            ))}
          </div>
          <div className="separator" aria-hidden="true" />
          <div className="modal-footer">
            <button className="modal-back" onClick={() => setSelectedProvider(null)}>&#x2190; Back</button>
            <span className="modal-hint">Esc to close</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-terminal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Select Provider</div>
        <div className="separator" aria-hidden="true" />
        <div className="modal-options">
          {providers.map((p) => (
            <button
              key={p.id}
              className={`modal-option ${!p.hasApiKey ? 'option-disabled' : ''}`}
              onClick={() => p.hasApiKey && setSelectedProvider(p)}
              disabled={!p.hasApiKey}
            >
              <span className="option-arrow">{p.hasApiKey ? '\u2192' : ' '}</span>
              <span>{p.displayName}</span>
              {!p.hasApiKey && <span className="option-missing">key missing</span>}
              {p.hasApiKey && <span className="option-ready">&#x2713;</span>}
            </button>
          ))}
        </div>
        <div className="separator" aria-hidden="true" />
        <div className="modal-footer">
          <span />
          <span className="modal-hint">Esc to close</span>
        </div>
      </div>
    </div>
  );
}
