import { DynamicStructuredTool } from '@langchain/core/tools';
import { join } from 'node:path';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { listWorkspaceEntries, requireActiveWorkspace, resolveWorkspaceFilePath } from './common.js';

export const LIST_WORKSPACE_FILES_DESCRIPTION = `
List files and folders inside the active data-room workspace.

## When to Use

- Inspect what documents are available in the active workspace
- Check \`inputs\`, \`notes\`, or \`outputs\` before reading documents
- Verify generated files were written where expected

## When NOT to Use

- Reading document contents directly (use \`read_document\`)
- Searching across document text (use \`search_workspace\`)

## Usage Notes

- Works only when an active workspace is selected
- Paths are relative to the active workspace root
- Recursive listing is enabled by default
`.trim();

export const listWorkspaceFilesTool = new DynamicStructuredTool({
  name: 'list_workspace_files',
  description: 'List files and folders available inside the active workspace data room.',
  schema: z.object({
    path: z.string().optional().describe('Optional subdirectory inside the active workspace. Defaults to the workspace root.'),
    recursive: z.boolean().optional().describe('Whether to walk subdirectories recursively. Defaults to true.'),
    maxResults: z.number().min(1).max(500).optional().describe('Maximum number of entries to return. Defaults to 200.'),
  }),
  func: async ({ path, recursive, maxResults }) => {
    const workspace = requireActiveWorkspace();
    const basePath = path ? (await resolveWorkspaceFilePath(path)).resolved : workspace.rootDir;
    const prefix = path?.replace(/^\.\/?/, '').replace(/\/$/, '') ?? '';
    const entries = await listWorkspaceEntries(basePath, recursive ?? true);
    const limited = entries.slice(0, maxResults ?? 200).map((entry) => ({
      path: prefix ? join(prefix, entry.path) : entry.path,
      kind: entry.kind,
      size: entry.size,
    }));

    return formatToolResult({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        root: workspace.rootDir,
      },
      path: path ?? '.',
      totalEntries: entries.length,
      entries: limited,
      truncated: limited.length < entries.length,
    });
  },
});
