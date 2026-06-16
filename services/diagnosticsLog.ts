import type { DiagnosticsChannel, DiagnosticsLogEntry } from '../types';

const DIAGNOSTICS_LOG_STORAGE_KEY = 'foreground_diagnostics_log';
const MAX_DIAGNOSTICS_LOG_ENTRIES = 120;
const UTILITY_SOURCES = new Set(['foreground_notification', 'probe', 'probe_ui']);

const diagnosticsLogListeners = new Set<(entries: DiagnosticsLogEntry[]) => void>();

const inferDiagnosticsChannel = (entry: Partial<DiagnosticsLogEntry>): DiagnosticsChannel => {
  if (entry.channel) return entry.channel;
  if (entry.domain === 'bg_notification') return 'content';
  if (entry.source && (UTILITY_SOURCES.has(entry.source) || entry.source.startsWith('foreground_notification') || entry.source.startsWith('probe'))) {
    return 'utility';
  }
  return 'content';
};

export const normalizeDiagnosticsLogEntry = (
  entry: Partial<DiagnosticsLogEntry> & Pick<DiagnosticsLogEntry, 'domain' | 'source' | 'status' | 'message'>
): DiagnosticsLogEntry => {
  const resolvedEmotion = entry.resolvedEmotion ?? entry.emotion ?? null;
  const rawEmotion = entry.rawEmotion ?? entry.emotion ?? null;

  return {
    id: entry.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp || Date.now(),
    domain: entry.domain,
    channel: inferDiagnosticsChannel(entry),
    source: entry.source,
    status: entry.status,
    message: entry.message,
    emotion: entry.emotion ?? resolvedEmotion,
    rawEmotion,
    resolvedEmotion,
    cueType: entry.cueType ?? null,
    backend: entry.backend ?? null,
    markerDetected: entry.markerDetected,
    attempt: entry.attempt,
    reason: entry.reason ?? null,
    details: entry.details ?? null,
  };
};

const loadStoredDiagnosticsLogs = (): DiagnosticsLogEntry[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(DIAGNOSTICS_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .filter((entry): entry is Partial<DiagnosticsLogEntry> & Pick<DiagnosticsLogEntry, 'domain' | 'source' | 'status' | 'message'> => (
        typeof entry?.domain === 'string' &&
        typeof entry?.source === 'string' &&
        typeof entry?.status === 'string' &&
        typeof entry?.message === 'string'
      ))
      .map(normalizeDiagnosticsLogEntry);
  } catch (error) {
    console.warn('[DIAGNOSTICS] Failed to load stored foreground logs:', error);
    return [];
  }
};

let diagnosticsLogsState: DiagnosticsLogEntry[] = loadStoredDiagnosticsLogs();

const persistDiagnosticsLogs = (): void => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(DIAGNOSTICS_LOG_STORAGE_KEY, JSON.stringify(diagnosticsLogsState));
  } catch (error) {
    console.warn('[DIAGNOSTICS] Failed to persist foreground logs:', error);
  }
};

const emitDiagnosticsLogs = (): void => {
  const snapshot = getDiagnosticsLogsSnapshot();
  diagnosticsLogListeners.forEach(listener => listener(snapshot));
};

export const getDiagnosticsLogsSnapshot = (): DiagnosticsLogEntry[] => (
  diagnosticsLogsState.map(entry => ({ ...entry }))
);

export const subscribeToDiagnosticsLogs = (listener: (entries: DiagnosticsLogEntry[]) => void): (() => void) => {
  diagnosticsLogListeners.add(listener);
  listener(getDiagnosticsLogsSnapshot());
  return () => {
    diagnosticsLogListeners.delete(listener);
  };
};

export const appendDiagnosticsLog = (
  entry: Omit<DiagnosticsLogEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: number }
): DiagnosticsLogEntry => {
  const normalizedEntry = normalizeDiagnosticsLogEntry(entry);

  diagnosticsLogsState = [normalizedEntry, ...diagnosticsLogsState].slice(0, MAX_DIAGNOSTICS_LOG_ENTRIES);
  persistDiagnosticsLogs();
  emitDiagnosticsLogs();
  return normalizedEntry;
};

export const clearDiagnosticsLogs = (): void => {
  diagnosticsLogsState = [];
  persistDiagnosticsLogs();
  emitDiagnosticsLogs();
};
