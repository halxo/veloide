import { DEFAULT_SETTINGS, type EditorTab, type UserSettings } from '../model/types';

const SETTINGS_KEY = 'veloide:settings:v1';
const SCRATCH_TABS_KEY = 'veloide:scratch:v1';

export class LocalStore {
  async loadSettings(): Promise<UserSettings> {
    if (window.veloideDesktop) {
      try {
        return await window.veloideDesktop.getSettings();
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    if (window.veloideDesktop) {
      return window.veloideDesktop.updateSettings(patch);
    }
    const current = await this.loadSettings();
    const next = { ...current, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
    return next;
  }

  saveScratchRecovery(tabs: EditorTab[]): void {
    try {
      const scratchOnly = tabs
        .filter((t) => t.isScratch)
        .slice(0, 8)
        .map((t) => ({
          id: t.id,
          name: t.name,
          languageId: t.languageId,
          content: t.content,
        }));
      localStorage.setItem(SCRATCH_TABS_KEY, JSON.stringify(scratchOnly));
    } catch {
      // ignore
    }
  }

  loadScratchRecovery(): Array<{ id: string; name: string; languageId: string; content: string }> {
    try {
      const raw = localStorage.getItem(SCRATCH_TABS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
