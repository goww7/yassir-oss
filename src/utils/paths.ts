import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getCurrentProfile } from '../profile/current.js';

function resolveLegacyProfileStorageDir(preferredDir: string, profileId: string): string {
  if (profileId !== 'yassir-halal') {
    return preferredDir;
  }

  const legacyDir = '.yassir';
  if (existsSync(preferredDir) || !existsSync(legacyDir)) {
    return preferredDir;
  }

  return legacyDir;
}

export function getYassirDir(): string {
  const profile = getCurrentProfile();
  return resolveLegacyProfileStorageDir(profile.brand.storageDir, profile.id);
}

export function yassirPath(...segments: string[]): string {
  return join(getYassirDir(), ...segments);
}
