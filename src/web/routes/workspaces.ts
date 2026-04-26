import { Hono } from 'hono';
import {
  createWorkspace,
  listWorkspaces,
  getActiveWorkspace,
  setActiveWorkspaceId,
  getWorkspaceById,
} from '../../workspace/manager.js';
import { listWorkspaceEntries } from '../../tools/workspace/common.js';
import { extractDocumentPreview } from '../../tools/workspace/document-reader.js';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, basename, resolve, relative } from 'path';

const workspaces = new Hono();

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

function safeUploadName(name: string): string {
  const safe = basename(name).replace(/[^\w.\- ]+/g, '_').trim();
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('Invalid filename');
  }
  return safe;
}

function resolveInside(parent: string, childName: string): string {
  const destPath = resolve(parent, safeUploadName(childName));
  if (!isInside(parent, destPath)) {
    throw new Error('Path outside workspace');
  }
  return destPath;
}

workspaces.get('/workspaces', (c) => {
  const all = listWorkspaces().map((ws) => ({
    id: ws.id,
    name: ws.name,
    createdAt: ws.createdAt,
  }));
  const active = getActiveWorkspace();
  return c.json({
    workspaces: all,
    activeWorkspaceId: active?.id ?? null,
    activeWorkspaceName: active?.name ?? null,
  });
});

workspaces.post('/workspace', async (c) => {
  const body = await c.req.json<{ name: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const ws = createWorkspace(body.name.trim());
  return c.json({ id: ws.id, name: ws.name });
});

workspaces.put('/workspace/active', async (c) => {
  const body = await c.req.json<{ workspaceId: string | null }>();
  const ok = setActiveWorkspaceId(body.workspaceId);
  if (!ok && body.workspaceId) return c.json({ error: 'Workspace not found' }, 404);
  const active = getActiveWorkspace();
  return c.json({ activeWorkspaceId: active?.id ?? null, activeWorkspaceName: active?.name ?? null });
});

workspaces.get('/workspace/:id', (c) => {
  const ws = getWorkspaceById(c.req.param('id'));
  if (!ws) return c.json({ error: 'Workspace not found' }, 404);
  return c.json({ id: ws.id, name: ws.name, rootDir: ws.rootDir, createdAt: ws.createdAt });
});

workspaces.post('/attach', async (c) => {
  const active = getActiveWorkspace();
  if (!active) return c.json({ error: 'No active workspace. Create one first with /workspace new <name>' }, 400);

  const contentType = c.req.header('content-type') ?? '';

  // Handle multipart file upload
  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json({ error: 'No file provided' }, 400);

    const inputsDir = active.inputsDir;
    if (!existsSync(inputsDir)) mkdirSync(inputsDir, { recursive: true });

    let destPath: string;
    try {
      destPath = resolveInside(inputsDir, file.name);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid filename' }, 400);
    }
    const buffer = await file.arrayBuffer();
    writeFileSync(destPath, Buffer.from(buffer));
    const filename = basename(destPath);

    return c.json({
      ok: true,
      filename,
      size: file.size,
      destination: destPath,
      workspace: active.name,
    });
  }

  // Handle JSON body with base64 content
  const body = await c.req.json<{ filename: string; content: string }>();
  if (!body.filename || !body.content) return c.json({ error: 'filename and content required' }, 400);

  const inputsDir = active.inputsDir;
  if (!existsSync(inputsDir)) mkdirSync(inputsDir, { recursive: true });

  let destPath: string;
  try {
    destPath = resolveInside(inputsDir, body.filename);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid filename' }, 400);
  }
  const buffer = Buffer.from(body.content, 'base64');
  writeFileSync(destPath, buffer);

  return c.json({
    ok: true,
    filename: body.filename,
    size: buffer.length,
    destination: destPath,
    workspace: active.name,
  });
});

// List files in workspace (tree view)
workspaces.get('/workspace/:id/files', async (c) => {
  const ws = getWorkspaceById(c.req.param('id'));
  if (!ws) return c.json({ error: 'Workspace not found' }, 404);

  try {
    const entries = await listWorkspaceEntries(ws.rootDir, true);
    // Build tree structure
    const tree = entries.map((e) => ({
      path: e.path,
      size: e.size,
      kind: e.kind,
      sizeFormatted: e.kind === 'file' ? formatSize(e.size) : undefined,
    }));
    return c.json({ workspaceId: ws.id, workspaceName: ws.name, files: tree });
  } catch {
    return c.json({ workspaceId: ws.id, workspaceName: ws.name, files: [] });
  }
});

// Preview a document in workspace
workspaces.get('/workspace/:id/preview', async (c) => {
  const ws = getWorkspaceById(c.req.param('id'));
  if (!ws) return c.json({ error: 'Workspace not found' }, 404);

  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'path query parameter required' }, 400);

  const absolutePath = resolve(ws.rootDir, filePath);
  if (!isInside(ws.rootDir, absolutePath)) return c.json({ error: 'Path outside workspace' }, 403);
  if (!existsSync(absolutePath)) return c.json({ error: 'File not found' }, 404);

  try {
    const doc = await extractDocumentPreview(absolutePath, 10_000);
    return c.json({
      path: filePath,
      content: doc.content,
      metadata: doc.metadata,
      truncated: doc.metadata?.truncated ?? doc.content.length >= 10_000,
    });
  } catch (err: unknown) {
    return c.json({ error: `Failed to read file: ${err instanceof Error ? err.message : 'unknown'}` }, 500);
  }
});

// Delete a file from workspace
workspaces.delete('/workspace/:id/file', async (c) => {
  const ws = getWorkspaceById(c.req.param('id'));
  if (!ws) return c.json({ error: 'Workspace not found' }, 404);

  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'path query parameter required' }, 400);

  const absolutePath = resolve(ws.rootDir, filePath);
  if (!isInside(ws.rootDir, absolutePath)) return c.json({ error: 'Path outside workspace' }, 403);
  if (!existsSync(absolutePath)) return c.json({ error: 'File not found' }, 404);

  try {
    unlinkSync(absolutePath);
    return c.json({ ok: true, deleted: filePath });
  } catch (err: unknown) {
    return c.json({ error: `Failed to delete: ${err instanceof Error ? err.message : 'unknown'}` }, 500);
  }
});

// Upload to specific workspace folder
workspaces.post('/workspace/:id/upload', async (c) => {
  const ws = getWorkspaceById(c.req.param('id'));
  if (!ws) return c.json({ error: 'Workspace not found' }, 404);

  const folder = c.req.query('folder') ?? 'inputs';
  const validFolders = ['inputs', 'notes', 'outputs'];
  if (!validFolders.includes(folder)) return c.json({ error: `Invalid folder: ${folder}` }, 400);

  const targetDir = join(ws.rootDir, folder);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const formData = await c.req.formData();
  const files = formData.getAll('file') as File[];
  if (files.length === 0) return c.json({ error: 'No files provided' }, 400);

  const results = [];
  for (const file of files) {
    let destPath: string;
    try {
      destPath = resolveInside(targetDir, file.name);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid filename' }, 400);
    }
    const buffer = await file.arrayBuffer();
    writeFileSync(destPath, Buffer.from(buffer));
    const filename = basename(destPath);
    results.push({ filename, size: file.size, folder, path: `${folder}/${filename}` });
  }

  return c.json({ ok: true, uploaded: results, workspace: ws.name });
});

// Download a file from workspace
workspaces.get('/workspace/:id/download', (c) => {
  const ws = getWorkspaceById(c.req.param('id'));
  if (!ws) return c.json({ error: 'Workspace not found' }, 404);

  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'path query parameter required' }, 400);

  const absolutePath = resolve(ws.rootDir, filePath);
  if (!isInside(ws.rootDir, absolutePath)) return c.json({ error: 'Path outside workspace' }, 403);
  if (!existsSync(absolutePath)) return c.json({ error: 'File not found' }, 404);

  const file = Bun.file(absolutePath);
  const filename = basename(filePath);
  return new Response(file, {
    headers: {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': file.type || 'application/octet-stream',
    },
  });
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export { workspaces };
