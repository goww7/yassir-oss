import { DynamicStructuredTool } from '@langchain/core/tools';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { listWorkspaceEntries, requireActiveWorkspace } from './common.js';
import { extractDocumentPreview, isSupportedDocumentPath } from './document-reader.js';

export const SEARCH_WORKSPACE_DESCRIPTION = `
Search the active data-room workspace by filename and extracted document content.

## When to Use

- Find which files mention a term across the active workspace
- Locate a spreadsheet, PDF, slide deck, or memo by topic
- Narrow down which documents to open with \`read_document\`

## When NOT to Use

- Reading a known document directly (use \`read_document\`)
- Simple folder listing (use \`list_workspace_files\`)

## Usage Notes

- Works only when an active workspace is selected
- Searches filenames first, then scans supported document text
- Limits full-content scanning to keep the run lightweight
`.trim();

function buildSnippet(content: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - 120);
  const end = Math.min(content.length, index + queryLength + 120);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

export const searchWorkspaceTool = new DynamicStructuredTool({
  name: 'search_workspace',
  description: 'Search files in the active workspace by filename and extracted document text.',
  schema: z.object({
    query: z.string().min(2).describe('Query to search for inside workspace filenames and document text.'),
    maxResults: z.number().min(1).max(50).optional().describe('Maximum matches to return. Defaults to 12.'),
    maxFilesToScan: z.number().min(1).max(150).optional().describe('Maximum files to content-scan. Defaults to 40.'),
  }),
  func: async ({ query, maxResults, maxFilesToScan }) => {
    const workspace = requireActiveWorkspace();
    const entries = await listWorkspaceEntries(workspace.rootDir, true);
    const files = entries.filter((entry) => entry.kind === 'file');
    const needle = query.toLowerCase();
    const matches: Array<Record<string, unknown>> = [];

    for (const file of files) {
      if (matches.length >= (maxResults ?? 12)) {
        break;
      }

      if (file.path.toLowerCase().includes(needle)) {
        matches.push({
          path: file.path,
          matchType: 'filename',
          size: file.size,
        });
      }
    }

    let scannedFiles = 0;
    for (const file of files) {
      if (matches.length >= (maxResults ?? 12)) {
        break;
      }
      if (scannedFiles >= (maxFilesToScan ?? 40)) {
        break;
      }
      if (!isSupportedDocumentPath(file.absolutePath)) {
        continue;
      }

      const fileStat = await stat(file.absolutePath);
      if (fileStat.size > 15_000_000) {
        continue;
      }

      scannedFiles++;
      const extracted = await extractDocumentPreview(file.absolutePath, 20_000).catch(() => null);
      if (!extracted) {
        continue;
      }

      const haystack = extracted.content.toLowerCase();
      const index = haystack.indexOf(needle);
      if (index === -1) {
        continue;
      }

      matches.push({
        path: file.path,
        matchType: 'content',
        kind: extracted.kind,
        size: file.size,
        snippet: buildSnippet(extracted.content, index, query.length),
      });
    }

    return formatToolResult({
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
      query,
      scannedFiles,
      totalFiles: files.length,
      matches,
      truncated: matches.length >= (maxResults ?? 12),
    });
  },
});
