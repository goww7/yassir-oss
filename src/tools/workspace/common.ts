import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { getActiveWorkspace } from '../../workspace/manager.js';
import { assertSandboxPath } from '../filesystem/sandbox.js';

export interface WorkspaceFileEntry {
  path: string;
  absolutePath: string;
  size: number;
  kind: 'file' | 'directory';
}

export function requireActiveWorkspace() {
  const workspace = getActiveWorkspace();
  if (!workspace) {
    throw new Error('No active workspace. Use /workspace new <name> or /workspace use <id> first.');
  }
  return workspace;
}

export async function resolveWorkspaceFilePath(filePath: string) {
  const workspace = requireActiveWorkspace();
  const { resolved, relative: relativePath } = await assertSandboxPath({
    filePath,
    cwd: workspace.rootDir,
    root: workspace.rootDir,
  });
  return {
    workspace,
    resolved,
    relativePath: relativePath || '.',
  };
}

export async function listWorkspaceEntries(rootPath: string, recursive: boolean, prefix = ''): Promise<WorkspaceFileEntry[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const output: WorkspaceFileEntry[] = [];

  for (const entry of entries) {
    if (entry.name === 'workspace.json') {
      continue;
    }

    const absolutePath = join(rootPath, entry.name);
    const relPath = prefix ? join(prefix, entry.name) : entry.name;
    const fileStat = await stat(absolutePath);

    output.push({
      path: relPath,
      absolutePath,
      size: fileStat.size,
      kind: entry.isDirectory() ? 'directory' : 'file',
    });

    if (recursive && entry.isDirectory()) {
      output.push(...(await listWorkspaceEntries(absolutePath, true, relPath)));
    }
  }

  return output.sort((a, b) => a.path.localeCompare(b.path));
}

export function toWorkspaceRelativePath(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath) || '.';
}
