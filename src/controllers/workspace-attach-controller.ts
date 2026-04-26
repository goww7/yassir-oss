import { copyFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getActiveWorkspace } from '../workspace/manager.js';

export type WorkspaceAttachAppState = 'idle' | 'browse' | 'importing' | 'done' | 'error';

export interface WorkspaceAttachEntry {
  value: string;
  label: string;
  description?: string;
}

export interface WorkspaceAttachState {
  appState: WorkspaceAttachAppState;
  currentDir: string;
  entries: WorkspaceAttachEntry[];
  message: string;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function normalizeUserPath(input: string): string {
  const trimmed = input.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.replace(/\\ /g, ' ');
}

async function getUniqueDestinationPath(targetDir: string, sourcePath: string): Promise<string> {
  const sourceName = basename(sourcePath);
  const extension = extname(sourceName);
  const stem = extension ? sourceName.slice(0, -extension.length) : sourceName;

  let candidate = join(targetDir, sourceName);
  let index = 2;
  while (true) {
    try {
      await stat(candidate);
      candidate = join(targetDir, `${stem}-${index}${extension}`);
      index++;
    } catch {
      return candidate;
    }
  }
}

export class WorkspaceAttachController {
  private _state: WorkspaceAttachState = {
    appState: 'idle',
    currentDir: homedir(),
    entries: [],
    message: '',
  };

  constructor(private readonly onUpdate: () => void) {}

  get state(): WorkspaceAttachState {
    return this._state;
  }

  isActive(): boolean {
    return this._state.appState !== 'idle';
  }

  async open(startDir?: string): Promise<boolean> {
    const workspace = getActiveWorkspace();
    if (!workspace) {
      this._state = {
        appState: 'error',
        currentDir: '',
        entries: [],
        message: 'No active workspace. Use `/workspace new <name>` or `/workspace use <id>` first.',
      };
      this.onUpdate();
      return false;
    }

    const initialDir = resolve(startDir ?? homedir());
    await this.loadDirectory(initialDir);
    return true;
  }

  async importFromUserPath(inputPath: string): Promise<string> {
    const workspace = getActiveWorkspace();
    if (!workspace) {
      throw new Error('No active workspace. Use `/workspace new <name>` or `/workspace use <id>` first.');
    }

    const sourcePath = resolve(normalizeUserPath(inputPath));
    this._state = {
      ...this._state,
      appState: 'importing',
      message: `Importing ${sourcePath}...`,
    };
    this.onUpdate();

    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) {
      throw new Error(`Not a file: ${sourcePath}`);
    }

    const destinationPath = await getUniqueDestinationPath(workspace.inputsDir, sourcePath);
    await copyFile(sourcePath, destinationPath);

    this._state = {
      appState: 'done',
      currentDir: dirname(sourcePath),
      entries: [],
      message: `Imported ${basename(sourcePath)} to ${destinationPath}`,
    };
    this.onUpdate();
    return destinationPath;
  }

  async handleSelect(value: string | null): Promise<void> {
    if (!value) {
      this.close();
      return;
    }
    if (value === '__up__') {
      await this.loadDirectory(dirname(this._state.currentDir));
      return;
    }
    if (value.startsWith('dir:')) {
      await this.loadDirectory(value.slice(4));
      return;
    }
    if (value.startsWith('file:')) {
      await this.importFromUserPath(value.slice(5));
      return;
    }
  }

  dismissDone(): void {
    this.close();
  }

  close(): void {
    this._state = {
      appState: 'idle',
      currentDir: homedir(),
      entries: [],
      message: '',
    };
    this.onUpdate();
  }

  async fail(error: unknown): Promise<void> {
    this._state = {
      appState: 'error',
      currentDir: this._state.currentDir,
      entries: [],
      message: error instanceof Error ? error.message : String(error),
    };
    this.onUpdate();
  }

  private async loadDirectory(targetDir: string): Promise<void> {
    const resolvedDir = resolve(targetDir);
    const entries = await readdir(resolvedDir, { withFileTypes: true });
    const items: WorkspaceAttachEntry[] = [];

    if (dirname(resolvedDir) !== resolvedDir) {
      items.push({
        value: '__up__',
        label: '..',
        description: 'Go to parent directory',
      });
    }

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = entries
      .filter((entry) => entry.isFile())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of directories.slice(0, 200)) {
      const absolutePath = join(resolvedDir, entry.name);
      items.push({
        value: `dir:${absolutePath}`,
        label: `${entry.name}/`,
        description: 'Folder',
      });
    }

    for (const entry of files.slice(0, 300)) {
      const absolutePath = join(resolvedDir, entry.name);
      const fileStat = await stat(absolutePath);
      items.push({
        value: `file:${absolutePath}`,
        label: entry.name,
        description: formatBytes(fileStat.size),
      });
    }

    this._state = {
      appState: 'browse',
      currentDir: resolvedDir,
      entries: items,
      message: '',
    };
    this.onUpdate();
  }
}
