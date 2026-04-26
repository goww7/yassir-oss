import { useState, useEffect, useRef } from 'react';

interface Workspace { id: string; name: string; createdAt?: string; }

interface Props {
  onClose: () => void;
  onMessage: (msg: string) => void;
}

export function WorkspacePanel({ onClose, onMessage }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const res = await fetch('/api/workspaces');
    const data = await res.json();
    setWorkspaces(data.workspaces ?? []);
    setActiveId(data.activeWorkspaceId);
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json();
    setNewName('');
    onMessage(`Workspace "${data.name}" created (${data.id})`);
    refresh();
  };

  const handleActivate = async (id: string) => {
    await fetch('/api/workspace/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: id }),
    });
    setActiveId(id);
    const ws = workspaces.find((w) => w.id === id);
    onMessage(`Switched to workspace "${ws?.name ?? id}"`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!activeId) { onMessage('No active workspace. Create or select one first.'); return; }
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/attach', { method: 'POST', body: formData });
    const data = await res.json();
    setUploading(false);
    if (data.ok) {
      onMessage(`Attached "${data.filename}" (${(data.size / 1024).toFixed(1)}KB) to workspace "${data.workspace}"`);
    } else {
      onMessage(`Upload failed: ${data.error}`);
    }
    e.target.value = '';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-terminal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 500 }}>
        <div className="modal-title">Workspaces</div>
        <div className="separator">{'─'.repeat(55)}</div>

        {/* Active workspace */}
        <div style={{ padding: '4px 0', color: 'var(--text-muted)', fontSize: 12 }}>
          Active: {activeId ? <span style={{ color: 'var(--primary)' }}>{workspaces.find((w) => w.id === activeId)?.name ?? activeId}</span> : <span style={{ color: 'var(--warning)' }}>none</span>}
        </div>

        {/* Workspace list */}
        <div className="modal-options">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              className={`modal-option ${ws.id === activeId ? '' : ''}`}
              onClick={() => handleActivate(ws.id)}
            >
              <span className="option-arrow">{ws.id === activeId ? '●' : '→'}</span>
              {ws.name}
              <span className="option-meta">{ws.id}</span>
            </button>
          ))}
          {workspaces.length === 0 && (
            <div style={{ color: 'var(--text-muted)', padding: '4px 8px', fontSize: 12 }}>No workspaces yet</div>
          )}
        </div>

        <div className="separator">{'─'.repeat(55)}</div>

        {/* Create new */}
        <div style={{ display: 'flex', gap: 8, padding: '6px 0' }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="New workspace name..."
            className="terminal-input"
            style={{ border: '1px solid var(--border)', padding: '4px 8px', borderRadius: 3, fontSize: 12 }}
          />
          <button className="modal-back" onClick={handleCreate} style={{ color: 'var(--primary)' }}>Create</button>
        </div>

        {/* File upload */}
        <div style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'center' }}>
          <input ref={fileInputRef} type="file" onChange={handleFileUpload} style={{ display: 'none' }} />
          <button className="modal-back" onClick={() => fileInputRef.current?.click()} style={{ color: 'var(--primary)' }}>
            {uploading ? 'Uploading...' : 'Attach file'}
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {activeId ? 'Imports to active workspace inputs/' : 'Select a workspace first'}
          </span>
        </div>

        <div className="separator">{'─'.repeat(55)}</div>
        <div className="modal-footer">
          <span className="modal-hint">Esc to close</span>
        </div>
      </div>
    </div>
  );
}
