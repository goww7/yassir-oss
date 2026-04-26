import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { checkApiKeyExists } from '../utils/env.js';
import { DEFAULT_PROFILE_ID, getProfileById, listAllProfiles, PROFILES } from './registry.js';
import type { AppProfile } from './types.js';

config({ quiet: true });

let cachedProfile: AppProfile | null = null;
let sessionProfileId: string | null = null;
const DEFAULT_PROFILE_FILE = join('.agents', 'profile.json');

function shouldUseStoredProfileId(): boolean {
  return Boolean(process.stdin?.isTTY && process.stdout?.isTTY);
}

function loadStoredProfileId(): string | null {
  if (!shouldUseStoredProfileId()) {
    return null;
  }
  if (!existsSync(DEFAULT_PROFILE_FILE)) {
    return null;
  }

  try {
    const raw = readFileSync(DEFAULT_PROFILE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { profileId?: string };
    return typeof parsed.profileId === 'string' && parsed.profileId.trim() ? parsed.profileId.trim() : null;
  } catch {
    return null;
  }
}

export function saveDefaultProfileId(profileId: string): boolean {
  try {
    const dir = dirname(DEFAULT_PROFILE_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(DEFAULT_PROFILE_FILE, JSON.stringify({ profileId }, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function getCurrentProfile(): AppProfile {
  if (cachedProfile) {
    return cachedProfile;
  }

  const requestedProfileId =
    sessionProfileId ||
    process.env.APP_PROFILE?.trim() ||
    process.env.YASSIR_PROFILE?.trim() ||
    loadStoredProfileId() ||
    DEFAULT_PROFILE_ID;
  cachedProfile = getProfileById(requestedProfileId) ?? getProfileById(DEFAULT_PROFILE_ID) ?? PROFILES[0]!;
  return cachedProfile;
}

export function setCurrentProfileId(profileId: string): void {
  sessionProfileId = profileId;
  cachedProfile = getProfileById(profileId) ?? getProfileById(DEFAULT_PROFILE_ID) ?? PROFILES[0]!;
}

export function getCurrentProfileId(): string {
  return getCurrentProfile().id;
}

export function listProfiles(): AppProfile[] {
  return listAllProfiles();
}

export function hasCurrentProfileBackendConfigured(): boolean {
  const backendEnvVar = getCurrentProfile().vertical.backend?.envVar;
  return backendEnvVar ? checkApiKeyExists(backendEnvVar) : false;
}
