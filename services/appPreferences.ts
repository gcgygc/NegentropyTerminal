import type { AppPreferences } from '../types';

const APP_PREFERENCES_STORAGE_KEY = 'app_preferences';

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  hapticsEnabled: false,
};

const listeners = new Set<(preferences: AppPreferences) => void>();

const normalizeAppPreferences = (preferences?: Partial<AppPreferences> | null): AppPreferences => ({
  ...DEFAULT_APP_PREFERENCES,
  ...(preferences || {}),
  hapticsEnabled: preferences?.hapticsEnabled === true,
});

const loadStoredPreferences = (): AppPreferences => {
  if (typeof window === 'undefined') return DEFAULT_APP_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(APP_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_PREFERENCES;
    return normalizeAppPreferences(JSON.parse(raw) as Partial<AppPreferences>);
  } catch (error) {
    console.warn('[APP_PREFERENCES] Failed to load preferences:', error);
    return DEFAULT_APP_PREFERENCES;
  }
};

let preferencesState: AppPreferences = loadStoredPreferences();

const persistPreferences = (): void => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferencesState));
  } catch (error) {
    console.warn('[APP_PREFERENCES] Failed to persist preferences:', error);
  }
};

const emitPreferences = (): void => {
  const snapshot = getAppPreferencesSnapshot();
  listeners.forEach(listener => listener(snapshot));
};

export const getAppPreferencesSnapshot = (): AppPreferences => ({ ...preferencesState });

export const setAppPreferences = (nextPreferences: Partial<AppPreferences> | AppPreferences): AppPreferences => {
  preferencesState = normalizeAppPreferences({
    ...preferencesState,
    ...(nextPreferences || {}),
  });
  persistPreferences();
  emitPreferences();
  return getAppPreferencesSnapshot();
};

export const subscribeToAppPreferences = (listener: (preferences: AppPreferences) => void): (() => void) => {
  listeners.add(listener);
  listener(getAppPreferencesSnapshot());
  return () => {
    listeners.delete(listener);
  };
};
