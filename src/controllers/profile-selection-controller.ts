import { getCurrentProfileId, listProfiles, saveDefaultProfileId, setCurrentProfileId } from '../profile/current.js';
import type { AppProfile } from '../profile/types.js';

export type ProfileSelectionAppState = 'idle' | 'profile_select' | 'done';

export interface ProfileSelectionState {
  appState: ProfileSelectionAppState;
  profiles: AppProfile[];
  currentProfileId: string;
  savedProfile: AppProfile | null;
}

export class ProfileSelectionController {
  private _state: ProfileSelectionState = {
    appState: 'idle',
    profiles: [],
    currentProfileId: getCurrentProfileId(),
    savedProfile: null,
  };
  private readonly onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  get state(): ProfileSelectionState {
    return this._state;
  }

  isActive(): boolean {
    return this._state.appState !== 'idle';
  }

  open(): void {
    this._state = {
      appState: 'profile_select',
      profiles: listProfiles(),
      currentProfileId: getCurrentProfileId(),
      savedProfile: null,
    };
    this.onUpdate();
  }

  handleProfileSelect(profileId: string | null): void {
    if (!profileId) {
      this.close();
      return;
    }

    const selected = listProfiles().find((profile) => profile.id === profileId) ?? null;
    if (!selected) {
      this.close();
      return;
    }

    saveDefaultProfileId(profileId);
    setCurrentProfileId(profileId);
    this._state = {
      appState: 'done',
      profiles: [],
      currentProfileId: profileId,
      savedProfile: selected,
    };
    this.onUpdate();
  }

  dismissDone(): void {
    this.close();
  }

  close(): void {
    this._state = {
      appState: 'idle',
      profiles: [],
      currentProfileId: getCurrentProfileId(),
      savedProfile: null,
    };
    this.onUpdate();
  }
}
