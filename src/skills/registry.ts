import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SkillMetadata, Skill, SkillSource } from './types.js';
import { extractSkillMetadata, loadSkillFromPath } from './loader.js';
import { yassirPath } from '../utils/paths.js';
import { getCurrentProfileId } from '../profile/current.js';

// Get the directory of this file to locate builtin skills
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Skill directories in order of precedence (later overrides earlier).
 * Computed lazily to avoid calling yassirPath() at module init time
 * (which triggers getCurrentProfile() before module initialization completes).
 */
function getSkillDirectories(): { path: string; source: SkillSource }[] {
  return [
    { path: __dirname, source: 'builtin' },
    { path: join(process.cwd(), yassirPath('skills')), source: 'project' },
  ];
}

// Cache for discovered skills (metadata only)
let skillMetadataCache: Map<string, SkillMetadata> | null = null;

/**
 * Scan a directory for SKILL.md files and return their metadata.
 * Looks for directories containing SKILL.md files.
 *
 * @param dirPath - Directory to scan
 * @param source - Source type for discovered skills
 * @returns Array of skill metadata
 */
function scanSkillDirectory(dirPath: string, source: SkillSource): SkillMetadata[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const skills: SkillMetadata[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFilePath = join(dirPath, entry.name, 'SKILL.md');
      if (existsSync(skillFilePath)) {
        try {
          const metadata = extractSkillMetadata(skillFilePath, source);
          skills.push(metadata);
        } catch {
          // Skip invalid skill files silently
        }
      }
    }
  }

  return skills;
}

/**
 * Scan profile-local skill directories (.agents/profiles/{id}/skills/).
 * Skills found here are automatically scoped to that profile ID.
 */
function getProfileSkillDirectories(): { path: string; source: SkillSource; profileId: string }[] {
  const profilesDir = join(process.cwd(), '.agents', 'profiles');
  if (!existsSync(profilesDir)) return [];
  return readdirSync(profilesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      path: join(profilesDir, d.name, 'skills'),
      source: 'project' as SkillSource,
      profileId: d.name,
    }));
}

/**
 * Discover all available skills from all skill directories.
 * Later sources (project > user > builtin) override earlier ones.
 * Profile-local skills are auto-scoped to their parent profile.
 * Returns only skills visible to the current profile.
 *
 * @returns Array of skill metadata, deduplicated by name, filtered by current profile
 */
export function discoverSkills(): SkillMetadata[] {
  if (skillMetadataCache) {
    return filterSkillsByProfile(Array.from(skillMetadataCache.values()));
  }

  skillMetadataCache = new Map();

  // Global skill directories (builtin + project-level)
  for (const { path, source } of getSkillDirectories()) {
    const skills = scanSkillDirectory(path, source);
    for (const skill of skills) {
      skillMetadataCache.set(skill.name, skill);
    }
  }

  // Profile-local skill directories
  for (const { path, source, profileId } of getProfileSkillDirectories()) {
    const skills = scanSkillDirectory(path, source);
    for (const skill of skills) {
      // Auto-scope to the parent profile if no explicit profiles field
      if (!skill.profiles || skill.profiles.length === 0) {
        skill.profiles = [profileId];
      }
      skillMetadataCache.set(skill.name, skill);
    }
  }

  return filterSkillsByProfile(Array.from(skillMetadataCache.values()));
}

/**
 * Filter skills by the current profile ID.
 * Skills without a `profiles` field are visible to all profiles (global).
 */
function filterSkillsByProfile(skills: SkillMetadata[]): SkillMetadata[] {
  const currentProfileId = getCurrentProfileId();
  return skills.filter(skill => {
    if (!skill.profiles || skill.profiles.length === 0) return true;
    return skill.profiles.includes(currentProfileId);
  });
}

/**
 * Get a skill by name, loading full instructions.
 *
 * @param name - Name of the skill to load
 * @returns Full skill definition or undefined if not found
 */
export function getSkill(name: string): Skill | undefined {
  // Ensure cache is populated
  if (!skillMetadataCache) {
    discoverSkills();
  }

  const metadata = skillMetadataCache?.get(name);
  if (!metadata) {
    return undefined;
  }

  // Load full skill with instructions
  return loadSkillFromPath(metadata.path, metadata.source);
}

/**
 * Build the skill metadata section for the system prompt.
 * Only includes name and description (lightweight).
 *
 * @returns Formatted string for system prompt injection
 */
export function buildSkillMetadataSection(): string {
  const skills = discoverSkills();

  if (skills.length === 0) {
    return 'No skills available.';
  }

  return skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join('\n');
}

/**
 * Clear the skill cache. Useful for testing or when skills are added/removed.
 */
export function clearSkillCache(): void {
  skillMetadataCache = null;
}
