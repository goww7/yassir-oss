import { DynamicStructuredTool } from '@langchain/core/tools';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { resolveWorkspaceFilePath } from './common.js';
import { extractDocumentPreview } from './document-reader.js';

export const READ_DOCUMENT_DESCRIPTION = `
Read a document from the active data-room workspace and extract its usable text.

## When to Use

- Reading PDF, DOCX, PPTX, XLSX, CSV, TSV, JSON, or text files in the workspace
- Turning an uploaded document into plain text for analysis
- Inspecting slide decks, spreadsheets, and reports before summarizing them

## When NOT to Use

- Listing files without opening them (use \`list_workspace_files\`)
- Broad retrieval across many workspace files (use \`search_workspace\`)

## Usage Notes

- Works only inside the active workspace
- Supports: txt, md, json, csv, tsv, xlsx, xls, docx, pptx, pdf
- Returns extracted text plus basic metadata
`.trim();

export const readDocumentTool = new DynamicStructuredTool({
  name: 'read_document',
  description: 'Read and extract text from a supported document inside the active workspace.',
  schema: z.object({
    path: z.string().describe('Relative path to a document inside the active workspace.'),
    maxChars: z.number().min(100).max(100000).optional().describe('Maximum characters to return from the extracted content. Defaults to 40000.'),
  }),
  func: async ({ path, maxChars }) => {
    const { workspace, resolved, relativePath } = await resolveWorkspaceFilePath(path);
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      throw new Error(`Path is not a file: ${relativePath}`);
    }

    const extracted = await extractDocumentPreview(resolved, maxChars ?? 40_000);
    return formatToolResult({
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
      path: relativePath,
      bytes: fileStat.size,
      kind: extracted.kind,
      metadata: extracted.metadata,
      content: extracted.content,
    });
  },
});
