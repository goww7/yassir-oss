import { readFile, stat } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { XMLParser } from 'fast-xml-parser';

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.log',
]);

const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.tsv']);
const WORD_EXTENSIONS = new Set(['.docx']);
const PRESENTATION_EXTENSIONS = new Set(['.pptx']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const MAX_TEXT_BYTES = 2_000_000;
const XML_PARSER = new XMLParser({ ignoreAttributes: false, trimValues: true });

export interface ExtractedDocument {
  kind: 'text' | 'spreadsheet' | 'word' | 'presentation' | 'pdf';
  content: string;
  metadata: Record<string, unknown>;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, '').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').trim();
}

function collectTextNodes(node: unknown, output: string[]): void {
  if (typeof node === 'string') {
    const normalized = normalizeWhitespace(node);
    if (normalized) {
      output.push(normalized);
    }
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectTextNodes(item, output);
    }
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((key === 't' || key.endsWith(':t')) && typeof value === 'string') {
      const normalized = normalizeWhitespace(value);
      if (normalized) {
        output.push(normalized);
      }
      continue;
    }
    collectTextNodes(value, output);
  }
}

function truncateText(text: string, maxChars: number = 40_000): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars)}\n\n[Truncated at ${maxChars} characters.]`,
    truncated: true,
  };
}

async function extractPlainText(filePath: string): Promise<ExtractedDocument> {
  const fileInfo = await stat(filePath);
  const maxBytes = Math.min(Number(fileInfo.size), MAX_TEXT_BYTES);
  const buffer = await readFile(filePath);
  const content = buffer.subarray(0, maxBytes).toString('utf-8');
  const truncated = fileInfo.size > maxBytes;
  return {
    kind: 'text',
    content: truncated ? `${content}\n\n[Truncated at ${MAX_TEXT_BYTES} bytes.]` : content,
    metadata: {
      bytes: fileInfo.size,
      truncated,
    },
  };
}

async function extractSpreadsheet(filePath: string): Promise<ExtractedDocument> {
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', dense: true, cellDates: true });
  const sections: string[] = [];
  const sheetSummaries: Array<Record<string, unknown>> = [];

  for (const sheetName of workbook.SheetNames.slice(0, 10)) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    }) as unknown[][];

    const previewRows = rows.slice(0, 30).map((row) =>
      row
        .slice(0, 12)
        .map((cell) => normalizeWhitespace(String(cell ?? '')))
        .join(' | ')
        .trim(),
    );

    sections.push(`## Sheet: ${sheetName}\n${previewRows.filter(Boolean).join('\n') || '[No visible rows]'}`);
    sheetSummaries.push({
      sheet: sheetName,
      rows: rows.length,
      columns: Math.max(0, ...rows.map((row) => row.length)),
    });
  }

  return {
    kind: 'spreadsheet',
    content: sections.join('\n\n'),
    metadata: {
      sheetCount: workbook.SheetNames.length,
      sheets: sheetSummaries,
    },
  };
}

async function extractWordDocument(filePath: string): Promise<ExtractedDocument> {
  const buffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return {
    kind: 'word',
    content: result.value.trim(),
    metadata: {
      warnings: result.messages.map((message) => message.message),
    },
  };
}

function getSlideSortKey(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function extractPresentation(filePath: string): Promise<ExtractedDocument> {
  const buffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => getSlideSortKey(a) - getSlideSortKey(b));

  const slides: string[] = [];

  for (const slidePath of slidePaths) {
    const xml = await zip.file(slidePath)?.async('text');
    if (!xml) {
      continue;
    }
    const parsed = XML_PARSER.parse(xml);
    const textRuns: string[] = [];
    collectTextNodes(parsed, textRuns);
    slides.push(
      `## Slide ${getSlideSortKey(slidePath)}\n${textRuns.map((line) => decodeXmlEntities(line)).join('\n') || '[No extracted text]'}`,
    );
  }

  return {
    kind: 'presentation',
    content: slides.join('\n\n'),
    metadata: {
      slideCount: slidePaths.length,
    },
  };
}

async function extractPdf(filePath: string): Promise<ExtractedDocument> {
  const buffer = await readFile(filePath);
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return {
      kind: 'pdf',
      content: result.text.trim(),
      metadata: {
        pages: result.pages.length,
      },
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export function isSupportedDocumentPath(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return (
    TEXT_EXTENSIONS.has(extension) ||
    SPREADSHEET_EXTENSIONS.has(extension) ||
    WORD_EXTENSIONS.has(extension) ||
    PRESENTATION_EXTENSIONS.has(extension) ||
    PDF_EXTENSIONS.has(extension)
  );
}

export async function extractDocument(filePath: string): Promise<ExtractedDocument> {
  const extension = extname(filePath).toLowerCase();

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return extractSpreadsheet(filePath);
  }
  if (WORD_EXTENSIONS.has(extension)) {
    return extractWordDocument(filePath);
  }
  if (PRESENTATION_EXTENSIONS.has(extension)) {
    return extractPresentation(filePath);
  }
  if (PDF_EXTENSIONS.has(extension)) {
    return extractPdf(filePath);
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return extractPlainText(filePath);
  }

  throw new Error(
    `Unsupported document type for ${basename(filePath)}. Supported formats: txt, md, json, csv, tsv, xlsx, xls, docx, pptx, pdf.`,
  );
}

export async function extractDocumentPreview(filePath: string, maxChars: number = 40_000): Promise<ExtractedDocument> {
  const extracted = await extractDocument(filePath);
  const truncated = truncateText(extracted.content, maxChars);
  return {
    ...extracted,
    content: truncated.text,
    metadata: {
      ...extracted.metadata,
      truncated: truncated.truncated,
    },
  };
}
