import { useState, useEffect, useRef, useCallback } from 'react';

interface FileEntry {
  path: string;
  size: number;
  kind: 'file' | 'directory';
  sizeFormatted?: string;
}

interface Workspace {
  id: string;
  name: string;
  createdAt?: string;
}

interface PreviewData {
  path: string;
  content: string;
  truncated: boolean;
}

interface Props {
  onClose: () => void;
  onMessage: (msg: string) => void;
}

export function WorkspaceExplorer({ onClose, onMessage }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadFolder, setUploadFolder] = useState('inputs');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshWorkspaces = async () => {
    const res = await fetch('/api/workspaces');
    const data = await res.json();
    setWorkspaces(data.workspaces ?? []);
    setActiveId(data.activeWorkspaceId);
  };

  const refreshFiles = useCallback(async (wsId: string) => {
    const res = await fetch(`/api/workspace/${wsId}/files`);
    const data = await res.json();
    setFiles(data.files ?? []);
  }, []);

  useEffect(() => { refreshWorkspaces(); }, []);
  useEffect(() => { if (activeId) refreshFiles(activeId); }, [activeId, refreshFiles]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (preview) setPreview(null); else onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, preview]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const res = await fetch('/api/workspace', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json();
    setNewName('');
    onMessage(`Workspace "${data.name}" created`);
    refreshWorkspaces();
  };

  const handleActivate = async (id: string) => {
    await fetch('/api/workspace/active', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: id }),
    });
    setActiveId(id);
  };

  const handlePreview = async (path: string) => {
    if (!activeId) return;
    setPreviewLoading(true);
    const res = await fetch(`/api/workspace/${activeId}/preview?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    setPreview(data.error ? null : data);
    setPreviewLoading(false);
  };

  const handleDelete = async (path: string) => {
    if (!activeId) return;
    await fetch(`/api/workspace/${activeId}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
    refreshFiles(activeId);
    if (preview?.path === path) setPreview(null);
  };

  const handleUpload = async (fileList: FileList | File[]) => {
    if (!activeId) { onMessage('Select a workspace first'); return; }
    setUploading(true);
    const formData = new FormData();
    for (const file of fileList) formData.append('file', file);
    const res = await fetch(`/api/workspace/${activeId}/upload?folder=${uploadFolder}`, { method: 'POST', body: formData });
    const data = await res.json();
    setUploading(false);
    if (data.ok) {
      onMessage(`Uploaded ${data.uploaded.length} file(s) to ${uploadFolder}/`);
      refreshFiles(activeId);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  };

  // Group files by top-level folder
  const folders = new Map<string, FileEntry[]>();
  for (const f of files) {
    const parts = f.path.split('/');
    const topFolder = parts.length > 1 ? parts[0] : '_root';
    if (!folders.has(topFolder)) folders.set(topFolder, []);
    if (f.kind === 'file') folders.get(topFolder)!.push(f);
  }

  const folderOrder = ['inputs', 'notes', 'outputs', 'index'];
  const sortedFolders = [...folders.entries()].sort(
    (a, b) => (folderOrder.indexOf(a[0]) === -1 ? 99 : folderOrder.indexOf(a[0])) - (folderOrder.indexOf(b[0]) === -1 ? 99 : folderOrder.indexOf(b[0])),
  );

  const folderIcons: Record<string, string> = { inputs: '📥', notes: '📝', outputs: '📤', index: '🗂' };

  return (
    <div className="explorer-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Workspace Explorer">
      <div className="explorer-panel" onClick={(e) => e.stopPropagation()}>

        {/* Sidebar: workspace list */}
        <div className="explorer-sidebar">
          <div className="explorer-section-title">Workspaces</div>
          <div className="explorer-ws-list">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                className={`explorer-ws-item ${ws.id === activeId ? 'active' : ''}`}
                onClick={() => handleActivate(ws.id)}
              >
                <span className="ws-dot">{ws.id === activeId ? '●' : '○'}</span>
                <span className="ws-name">{ws.name}</span>
              </button>
            ))}
          </div>

          {/* Create */}
          <div className="explorer-create">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="New workspace..."
              className="explorer-input"
            />
            <button className="explorer-btn" onClick={handleCreate}>+</button>
          </div>
        </div>

        {/* Main: file tree + preview */}
        <div className="explorer-main">
          {!activeId ? (
            <div className="explorer-empty">
              <div className="explorer-empty-text">Select or create a workspace to explore files</div>
            </div>
          ) : (
            <>
              {/* Upload area */}
              <div
                className={`explorer-upload-zone ${dragOver ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <div className="upload-content">
                  <span className="upload-icon">{uploading ? '⏳' : '📂'}</span>
                  <span className="upload-text">
                    {uploading ? 'Uploading...' : 'Drop files here or'}
                  </span>
                  <input ref={fileInputRef} type="file" multiple onChange={(e) => e.target.files && handleUpload(e.target.files)} style={{ display: 'none' }} />
                  <button className="upload-browse" onClick={() => fileInputRef.current?.click()}>browse</button>
                  <select className="upload-folder-select" value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)}>
                    <option value="inputs">→ inputs/</option>
                    <option value="notes">→ notes/</option>
                    <option value="outputs">→ outputs/</option>
                  </select>
                </div>
              </div>

              {/* File tree */}
              <div className="explorer-file-tree">
                {sortedFolders.map(([folder, folderFiles]) => (
                  <div key={folder} className="explorer-folder">
                    <div className="folder-header">
                      <span className="folder-icon">{folderIcons[folder] ?? '📁'}</span>
                      <span className="folder-name">{folder}/</span>
                      <span className="folder-count">{folderFiles.length}</span>
                    </div>
                    <div className="folder-files">
                      {folderFiles.map((f) => (
                        <div
                          key={f.path}
                          className={`file-row ${preview?.path === f.path ? 'active' : ''}`}
                        >
                          <button className="file-name" onClick={() => handlePreview(f.path)}>
                            {fileIcon(f.path)} {f.path.split('/').pop()}
                          </button>
                          <span className="file-size">{f.sizeFormatted}</span>
                          <a
                            className="file-download"
                            href={`/api/workspace/${activeId}/download?path=${encodeURIComponent(f.path)}`}
                            download
                            title="Download"
                            onClick={(e) => e.stopPropagation()}
                          >↓</a>
                          <button className="file-delete" onClick={() => handleDelete(f.path)} title="Delete">×</button>
                        </div>
                      ))}
                      {folderFiles.length === 0 && (
                        <div className="folder-empty">empty</div>
                      )}
                    </div>
                  </div>
                ))}
                {files.length === 0 && (
                  <div className="explorer-empty-text">No files yet. Upload some documents to get started.</div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Preview panel */}
        {preview && (
          <div className="explorer-preview">
            <div className="preview-header">
              <span className="preview-path">{preview.path}</span>
              <div className="preview-actions">
                <a
                  className="preview-download"
                  href={`/api/workspace/${activeId}/download?path=${encodeURIComponent(preview.path)}`}
                  download
                >↓ Download</a>
                <button className="preview-close" onClick={() => setPreview(null)}>×</button>
              </div>
            </div>
            <pre className="preview-content">{preview.content}</pre>
            {preview.truncated && <div className="preview-truncated">Content truncated at 10KB</div>}
          </div>
        )}
        {previewLoading && (
          <div className="explorer-preview">
            <div className="preview-header">Loading...</div>
          </div>
        )}
      </div>
    </div>
  );
}

function fileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const icons: Record<string, string> = {
    pdf: '📄', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊', csv: '📊',
    pptx: '📊', json: '{}', txt: '📃', md: '📃', xml: '📃', html: '🌐',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼',
    py: '🐍', ts: '💻', js: '💻', sh: '⚙',
  };
  return icons[ext] ?? '📎';
}
