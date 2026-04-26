import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '../utils/config.js';
import { yassirPath } from '../utils/paths.js';

const WORKSPACES_DIRNAME = 'workspaces';
const WORKSPACE_MANIFEST = 'workspace.json';

interface WorkspaceConfigShape {
  activeId?: string;
}

interface ConfigShape {
  workspace?: WorkspaceConfigShape;
  [key: string]: unknown;
}

interface WorkspaceManifest {
  id: string;
  name: string;
  createdAt: string;
}

export interface DataRoomWorkspace {
  id: string;
  name: string;
  rootDir: string;
  inputsDir: string;
  notesDir: string;
  outputsDir: string;
  indexDir: string;
  createdAt?: string;
}

function getConfig(): ConfigShape {
  return loadConfig() as ConfigShape;
}

function getWorkspacesRoot(): string {
  const root = yassirPath(WORKSPACES_DIRNAME);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

function getWorkspaceRootDir(id: string): string {
  return join(getWorkspacesRoot(), id);
}

function toWorkspace(manifest: WorkspaceManifest): DataRoomWorkspace {
  const rootDir = getWorkspaceRootDir(manifest.id);
  return {
    id: manifest.id,
    name: manifest.name,
    rootDir,
    inputsDir: join(rootDir, 'inputs'),
    notesDir: join(rootDir, 'notes'),
    outputsDir: join(rootDir, 'outputs'),
    indexDir: join(rootDir, 'index'),
    createdAt: manifest.createdAt,
  };
}

function ensureWorkspaceStructure(workspace: DataRoomWorkspace): void {
  for (const dir of [
    workspace.rootDir,
    workspace.inputsDir,
    workspace.notesDir,
    workspace.outputsDir,
    workspace.indexDir,
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function readManifest(id: string): WorkspaceManifest | null {
  const manifestPath = join(getWorkspaceRootDir(id), WORKSPACE_MANIFEST);
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<WorkspaceManifest>;
    if (!parsed.id || !parsed.name) {
      return null;
    }
    return {
      id: parsed.id,
      name: parsed.name,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeManifest(manifest: WorkspaceManifest): void {
  const workspace = toWorkspace(manifest);
  ensureWorkspaceStructure(workspace);
  writeFileSync(join(workspace.rootDir, WORKSPACE_MANIFEST), JSON.stringify(manifest, null, 2), 'utf-8');
}

function slugifyWorkspaceName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function getUniqueWorkspaceId(baseName: string): string {
  const base = slugifyWorkspaceName(baseName) || 'workspace';
  let candidate = base;
  let index = 2;
  while (existsSync(getWorkspaceRootDir(candidate))) {
    candidate = `${base}-${index}`;
    index++;
  }
  return candidate;
}

export function listWorkspaces(): DataRoomWorkspace[] {
  const root = getWorkspacesRoot();
  const workspaces: DataRoomWorkspace[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifest = readManifest(entry.name);
    if (!manifest) {
      continue;
    }
    const workspace = toWorkspace(manifest);
    ensureWorkspaceStructure(workspace);
    workspaces.push(workspace);
  }

  return workspaces.sort((a, b) => a.name.localeCompare(b.name));
}

export function createWorkspace(name: string): DataRoomWorkspace {
  const trimmedName = name.trim();
  const id = getUniqueWorkspaceId(trimmedName);
  const manifest: WorkspaceManifest = {
    id,
    name: trimmedName || 'Workspace',
    createdAt: new Date().toISOString(),
  };
  writeManifest(manifest);
  return toWorkspace(manifest);
}

export function getActiveWorkspaceId(): string | null {
  return getConfig().workspace?.activeId ?? null;
}

export function setActiveWorkspaceId(workspaceId: string | null): boolean {
  const config = getConfig();
  const workspaceConfig = { ...(config.workspace ?? {}) };

  if (!workspaceId) {
    delete workspaceConfig.activeId;
  } else {
    workspaceConfig.activeId = workspaceId;
  }

  config.workspace = workspaceConfig;
  return saveConfig(config);
}

export function getWorkspaceById(workspaceId: string): DataRoomWorkspace | null {
  const manifest = readManifest(workspaceId);
  if (!manifest) {
    return null;
  }
  const workspace = toWorkspace(manifest);
  ensureWorkspaceStructure(workspace);
  return workspace;
}

export function getActiveWorkspace(): DataRoomWorkspace | null {
  const activeId = getActiveWorkspaceId();
  if (!activeId) {
    return null;
  }
  return getWorkspaceById(activeId);
}

export function formatWorkspaceSummary(workspace: DataRoomWorkspace): string {
  return [
    `Workspace: ${workspace.name}`,
    `Id: ${workspace.id}`,
    `Folders: inputs/, notes/, outputs/, index/`,
  ].join('\n');
}
