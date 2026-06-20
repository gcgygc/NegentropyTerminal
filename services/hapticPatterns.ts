/**
 * hapticPatterns.ts
 * 情绪震动协议：
 * 1. 先从文本中解析 [HAPTIC:emotion] 标记
 * 2. UI 先展示文本，再由外部调用 scheduleHapticPlayback() 异步触发
 * 3. 内部使用非阻塞覆盖式播放，新的情绪会立即覆盖当前震动
 */

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { HapticCueType, HapticDiagnostics, NativeHapticStatus } from '../types';
import { getAppPreferencesSnapshot } from './appPreferences';
import { appendDiagnosticsLog } from './diagnosticsLog';

declare global {
  interface Window {
    NativeNotify?: {
      startStreamingChat?: (requestId: string, requestJson: string) => void;
      cancelStreamingChat?: (requestId: string) => void;
      postNotification?: (title: string, body: string) => void;
      playHapticPattern?: (patternJson: string) => void;
      cancelHaptics?: () => void;
      getHapticStatus?: () => string;
      getBackgroundDiagnosticsLog?: () => string;
      clearBackgroundDiagnosticsLog?: () => void;
    };
  }
}

export interface HapticPattern {
  name: string;
  description: string;
  pattern: number[]; // [vibrate, pause, vibrate, pause, ...]
  pulseAmplitudes?: number[]; // Android 原生波形强度，按每个振动段定义
  fallbackStyle?: ImpactStyle;
  fallbackNotificationType?: NotificationType;
  gapMs?: number;
}

export interface NativeWaveformPattern {
  label: string;
  timings: number[];
  amplitudes: number[];
  repeat: number;
}

export interface ResolvedHapticCue {
  rawEmotion: string;
  emotion: string;
  cueType: HapticCueType;
  patternLabel: string;
  waveform: NativeWaveformPattern;
  pattern?: HapticPattern;
}

export interface ParsedHapticMarkers {
  cleanText: string;
  cues: ResolvedHapticCue[];
  markerDetected: boolean;
  skipReason: 'missing_marker' | 'unknown_emotion' | 'invalid_custom_pattern' | null;
  rawEmotion?: string | null;
  resolvedEmotion?: string | null;
  cueType?: HapticCueType | null;
  parseError?: string | null;
}

const DEFAULT_GAP_MS = 48;
const HAPTIC_MARKER_REGEX = /\[HAPTIC:([a-z0-9_-]+)\]/gi;
const HAPTIC_CUSTOM_PATTERN_REGEX = /\[HAPTIC_PATTERN\]([\s\S]*?)\[\/HAPTIC_PATTERN\]/gi;
const MAX_CUSTOM_WAVEFORM_ENTRIES = 12;
const MIN_CUSTOM_WAVEFORM_ENTRIES = 2;
const MIN_TIMING_VALUE = 10;
const MAX_TIMING_VALUE = 400;
const MIN_TOTAL_DURATION = 80;
const MAX_TOTAL_DURATION = 1500;

export const HAPTIC_PATTERNS: Record<string, HapticPattern> = {
  warning: {
    name: '警告',
    description: '强力短促多次，带明显压迫感',
    pattern: [70, 35, 85, 35, 110],
    pulseAmplitudes: [255, 232, 255],
    fallbackStyle: ImpactStyle.Heavy,
  },
  alert: {
    name: '警觉',
    description: '急促三连，像神经瞬间绷紧',
    pattern: [50, 35, 50, 35, 50],
    pulseAmplitudes: [220, 240, 220],
    fallbackStyle: ImpactStyle.Heavy,
  },
  panic: {
    name: '惊慌',
    description: '碎裂而不安的抽动',
    pattern: [25, 35, 25, 25, 40, 25, 70],
    pulseAmplitudes: [190, 150, 210, 255],
    fallbackStyle: ImpactStyle.Heavy,
  },
  anger: {
    name: '愤怒',
    description: '密集连射，带爆发感',
    pattern: [35, 20, 35, 20, 55, 25, 95],
    pulseAmplitudes: [210, 235, 255, 255],
    fallbackStyle: ImpactStyle.Heavy,
  },
  comfort: {
    name: '安抚',
    description: '柔和、连续、包裹式的长脉冲',
    pattern: [80, 90, 120, 110, 160, 140, 220],
    pulseAmplitudes: [72, 84, 96, 108],
    fallbackStyle: ImpactStyle.Light,
    gapMs: 24,
  },
  gentle: {
    name: '轻柔',
    description: '非常轻的一次触碰',
    pattern: [36],
    pulseAmplitudes: [64],
    fallbackStyle: ImpactStyle.Light,
  },
  calm: {
    name: '平静',
    description: '舒缓而均匀，像慢慢放松下来',
    pattern: [55, 120, 90, 160, 120],
    pulseAmplitudes: [62, 74, 84],
    fallbackStyle: ImpactStyle.Light,
  },
  sadness: {
    name: '悲伤',
    description: '沉一点、慢一点、下坠感明显',
    pattern: [180, 150, 220],
    pulseAmplitudes: [118, 86],
    fallbackStyle: ImpactStyle.Medium,
  },
  melancholy: {
    name: '失落',
    description: '拉长的怅然感，像尾音下沉',
    pattern: [120, 120, 150, 200, 210],
    pulseAmplitudes: [88, 72, 60],
    fallbackStyle: ImpactStyle.Medium,
  },
  heartbeat: {
    name: '心跳',
    description: '明确的双击心跳节奏',
    pattern: [90, 70, 120, 260, 90, 70, 120],
    pulseAmplitudes: [160, 225, 160, 225],
    fallbackStyle: ImpactStyle.Medium,
  },
  affection: {
    name: '心动',
    description: '轻快的扑通感，像悄悄靠近',
    pattern: [30, 45, 40, 180, 60, 40, 80],
    pulseAmplitudes: [110, 146, 170, 196],
    fallbackStyle: ImpactStyle.Medium,
  },
  longing: {
    name: '思念',
    description: '前轻后重，带一点拖尾',
    pattern: [60, 80, 90, 110, 130],
    pulseAmplitudes: [88, 110, 136],
    fallbackStyle: ImpactStyle.Medium,
  },
  excitement: {
    name: '兴奋',
    description: '快速递增，像情绪一路上扬',
    pattern: [25, 25, 40, 25, 65, 25, 95, 25, 140],
    pulseAmplitudes: [116, 148, 180, 216, 255],
    fallbackStyle: ImpactStyle.Heavy,
  },
  nervousness: {
    name: '紧张',
    description: '不规则发颤，像指尖发冷',
    pattern: [20, 50, 35, 35, 20, 70, 45, 45, 30],
    pulseAmplitudes: [100, 84, 110, 132, 90],
    fallbackStyle: ImpactStyle.Light,
  },
  pride: {
    name: '骄傲',
    description: '稳健双击，姿态比较挺拔',
    pattern: [120, 90, 150],
    pulseAmplitudes: [170, 220],
    fallbackStyle: ImpactStyle.Heavy,
  },
  determination: {
    name: '坚定',
    description: '层层加重，像咬牙顶上去',
    pattern: [80, 60, 120, 60, 160],
    pulseAmplitudes: [128, 172, 220],
    fallbackStyle: ImpactStyle.Heavy,
  },
  success: {
    name: '成功',
    description: '清晰的确认回馈',
    pattern: [50, 70, 110],
    pulseAmplitudes: [140, 220],
    fallbackStyle: ImpactStyle.Medium,
    fallbackNotificationType: NotificationType.Success,
  },
  error: {
    name: '错误',
    description: '急促否定，直接打断',
    pattern: [85, 35, 85, 35, 85],
    pulseAmplitudes: [220, 255, 220],
    fallbackStyle: ImpactStyle.Heavy,
    fallbackNotificationType: NotificationType.Error,
  },
  curiosity: {
    name: '好奇',
    description: '轻快试探，像往前探一下',
    pattern: [25, 45, 45, 45, 70],
    pulseAmplitudes: [100, 118, 150],
    fallbackStyle: ImpactStyle.Light,
  },
  teasing: {
    name: '调侃',
    description: '俏皮跳一下，再故意停顿',
    pattern: [35, 55, 35, 105, 75],
    pulseAmplitudes: [120, 120, 176],
    fallbackStyle: ImpactStyle.Medium,
  },
};

const HAPTIC_ALIASES: Record<string, string> = {
  affectionate: 'affection',
  alarm: 'alert',
  anxious: 'nervousness',
  calmness: 'calm',
  care: 'comfort',
  caring: 'comfort',
  celebrate: 'success',
  cheerful: 'success',
  concerned: 'warning',
  comforting: 'comfort',
  crush: 'affection',
  danger: 'warning',
  determined: 'determination',
  flutter: 'heartbeat',
  fear: 'panic',
  flirt: 'teasing',
  flirty: 'teasing',
  grief: 'melancholy',
  happy: 'success',
  heart: 'heartbeat',
  heartbeat_fast: 'excitement',
  heartthrob: 'affection',
  intrigued: 'curiosity',
  joyful: 'success',
  love: 'affection',
  loving: 'affection',
  mischievous: 'teasing',
  mourn: 'melancholy',
  panic_attack: 'panic',
  peaceful: 'calm',
  playful: 'teasing',
  proud: 'pride',
  pulse: 'heartbeat',
  reassuring: 'gentle',
  reassure: 'comfort',
  romantic: 'affection',
  scolding: 'warning',
  sad: 'sadness',
  shocked: 'excitement',
  soothing: 'gentle',
  sorrow: 'melancholy',
  soft: 'gentle',
  soothe: 'comfort',
  sorrowful: 'sadness',
  stern: 'warning',
  surprise: 'excitement',
  surprised: 'excitement',
  tender: 'comfort',
  tense: 'nervousness',
  warm: 'comfort',
  urgent: 'warning',
  wow: 'excitement',
};

const SYNTHESIS_FAMILIES = ['warning', 'comfort', 'sadness', 'heartbeat', 'teasing'] as const;

type SynthesisFamily = typeof SYNTHESIS_FAMILIES[number];

type CustomPatternParseResult =
  | { cue: ResolvedHapticCue; parseError: string | null; rawLabel?: string | null; }
  | { cue: null; parseError: string; rawLabel?: string | null; };

const FAMILY_KEYWORDS: Record<SynthesisFamily, RegExp> = {
  warning: /(warn|alert|panic|anger|danger|alarm|urgent|error|stern|scold|shock|threat)/i,
  comfort: /(comfort|gentle|calm|soft|warm|tender|relief|relax|safe|sooth|reassur|quiet)/i,
  sadness: /(sad|sorrow|grief|melan|lonely|long|miss|hurt|cry|blue|ache)/i,
  heartbeat: /(heart|love|affection|romance|crush|pulse|flutter|beat)/i,
  teasing: /(tease|play|mischief|fun|cheer|happy|excite|wow|wink|smirk)/i,
};

function normalizeWaveformArray(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => typeof value === 'number' ? value : Number(value))
    .filter(value => Number.isFinite(value))
    .map(value => Math.round(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fnv1aHash(label: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function inferSynthesisFamily(label: string): SynthesisFamily {
  for (const family of SYNTHESIS_FAMILIES) {
    if (FAMILY_KEYWORDS[family].test(label)) {
      return family;
    }
  }
  return SYNTHESIS_FAMILIES[fnv1aHash(label) % SYNTHESIS_FAMILIES.length];
}

function buildWaveformFromCanonical(emotion: string, pattern: HapticPattern): NativeWaveformPattern {
  const timings: number[] = [0];
  const amplitudes: number[] = [0];
  let pulseIndex = 0;

  pattern.pattern.forEach((duration, index) => {
    const isPulse = index % 2 === 0;
    timings.push(duration);
    if (isPulse) {
      amplitudes.push(pattern.pulseAmplitudes?.[pulseIndex] ?? 180);
      pulseIndex += 1;
    } else {
      amplitudes.push(0);
    }
  });

  return {
    label: emotion,
    timings,
    amplitudes,
    repeat: -1,
  };
}

function validateCustomWaveform(
  waveform: NativeWaveformPattern
): { valid: true; waveform: NativeWaveformPattern } | { valid: false; error: string } {
  const timings = [...waveform.timings];
  const amplitudes = [...waveform.amplitudes];

  if (!timings.length || !amplitudes.length) {
    return { valid: false, error: 'Custom haptic pattern requires non-empty timings and amplitudes.' };
  }

  if (timings[0] !== 0) {
    timings.unshift(0);
    amplitudes.unshift(0);
  }

  if (timings.length !== amplitudes.length) {
    return { valid: false, error: 'Custom haptic pattern timings/amplitudes length mismatch.' };
  }

  if (timings.length < MIN_CUSTOM_WAVEFORM_ENTRIES || timings.length > MAX_CUSTOM_WAVEFORM_ENTRIES) {
    return { valid: false, error: `Custom haptic pattern must contain ${MIN_CUSTOM_WAVEFORM_ENTRIES}-${MAX_CUSTOM_WAVEFORM_ENTRIES} entries.` };
  }

  for (let index = 1; index < timings.length; index += 1) {
    if (timings[index] < MIN_TIMING_VALUE || timings[index] > MAX_TIMING_VALUE) {
      return { valid: false, error: `Custom haptic timing at index ${index} is out of bounds.` };
    }
  }

  const totalDuration = timings.reduce((sum, value) => sum + value, 0);
  if (totalDuration < MIN_TOTAL_DURATION || totalDuration > MAX_TOTAL_DURATION) {
    return { valid: false, error: 'Custom haptic pattern total duration is out of bounds.' };
  }

  if (timings[0] !== 0 || amplitudes[0] !== 0) {
    return { valid: false, error: 'Custom haptic pattern must start with a 0 timing and 0 amplitude.' };
  }

  const normalizedAmplitudes = amplitudes.map((value, index) => (
    index === 0 || index % 2 === 0 ? 0 : clamp(value, 1, 255)
  ));

  return {
    valid: true,
    waveform: {
      label: waveform.label,
      timings,
      amplitudes: normalizedAmplitudes,
      repeat: -1,
    },
  };
}

function buildCueFromCanonical(rawEmotion: string, resolvedEmotion: string): ResolvedHapticCue {
  const pattern = HAPTIC_PATTERNS[resolvedEmotion];
  return {
    rawEmotion,
    emotion: resolvedEmotion,
    cueType: 'canonical',
    patternLabel: resolvedEmotion,
    waveform: buildWaveformFromCanonical(resolvedEmotion, pattern),
    pattern,
  };
}

function synthesizeHapticPattern(label: string): ResolvedHapticCue {
  const normalizedLabel = normalizeEmotionKey(label);
  const family = inferSynthesisFamily(normalizedLabel);
  const baseHash = fnv1aHash(normalizedLabel);

  const baseTimingsByFamily: Record<SynthesisFamily, number[]> = {
    warning: [0, 45, 28, 70, 24, 110],
    comfort: [0, 78, 90, 116, 132, 164],
    sadness: [0, 120, 110, 176],
    heartbeat: [0, 72, 64, 112, 220, 72, 64, 112],
    teasing: [0, 32, 38, 44, 92, 72],
  };
  const baseAmplitudesByFamily: Record<SynthesisFamily, number[]> = {
    warning: [0, 220, 0, 208, 0, 255],
    comfort: [0, 88, 0, 102, 0, 118],
    sadness: [0, 118, 0, 88],
    heartbeat: [0, 148, 0, 214, 0, 148, 0, 214],
    teasing: [0, 118, 0, 140, 0, 186],
  };

  const timings = baseTimingsByFamily[family].map((value, index) => {
    if (index === 0) return 0;
    const bias = ((baseHash >>> ((index * 3) % 24)) & 0x1f) - 10;
    return clamp(value + bias, MIN_TIMING_VALUE, MAX_TIMING_VALUE);
  });

  const amplitudes = baseAmplitudesByFamily[family].map((value, index) => {
    if (index === 0 || value === 0) return 0;
    const bias = ((baseHash >>> ((index * 5 + 7) % 24)) & 0x3f) - 20;
    return clamp(value + bias, 48, 255);
  });

  const validated = validateCustomWaveform({
    label: normalizedLabel,
    timings,
    amplitudes,
    repeat: -1,
  });

  const waveform = validated.valid
    ? validated.waveform
    : buildWaveformFromCanonical(family, HAPTIC_PATTERNS[family]);

  return {
    rawEmotion: label,
    emotion: family,
    cueType: 'synthesized',
    patternLabel: normalizedLabel,
    waveform,
    pattern: HAPTIC_PATTERNS[family],
  };
}

function parseCustomPatternDirective(rawJson: string): CustomPatternParseResult {
  try {
    const parsed = JSON.parse(rawJson) as {
      label?: string;
      timings?: unknown;
      amplitudes?: unknown;
      repeat?: number;
    };
    const rawLabel = typeof parsed.label === 'string' ? parsed.label.trim() : '';
    if (!rawLabel) {
      return { cue: null, parseError: 'Custom haptic pattern is missing a label.', rawLabel: null };
    }

    const waveformCandidate: NativeWaveformPattern = {
      label: rawLabel,
      timings: normalizeWaveformArray(parsed.timings),
      amplitudes: normalizeWaveformArray(parsed.amplitudes),
      repeat: -1,
    };
    const validated = validateCustomWaveform(waveformCandidate);
    if (!validated.valid) {
      return {
        cue: synthesizeHapticPattern(rawLabel),
        parseError: 'error' in validated ? validated.error : 'Custom haptic pattern validation failed.',
      };
    }

    const fallbackFamily = inferSynthesisFamily(rawLabel);
    return {
      cue: {
        rawEmotion: rawLabel,
        emotion: rawLabel,
        cueType: 'custom',
        patternLabel: rawLabel,
        waveform: validated.waveform,
        pattern: HAPTIC_PATTERNS[fallbackFamily],
      },
      parseError: null,
    };
  } catch (error) {
    return {
      cue: null,
      parseError: `Failed to parse custom haptic JSON: ${serializeError(error)}`,
      rawLabel: null,
    };
  }
}

type ActivePlayback = {
  cue: ResolvedHapticCue;
  source: string;
  timeoutId: number;
};

let activePlayback: ActivePlayback | null = null;
let pendingPlayback: { cue: ResolvedHapticCue; source: string } | null = null;
let pendingFrameId: number | null = null;
let hapticDiagnostics: HapticDiagnostics = {
  lastBackend: 'unknown',
  lastEmotion: null,
  lastCueType: null,
  lastScheduledAt: null,
  lastError: null,
  nativeStatus: undefined,
  lastUpdatedAt: Date.now(),
};
const hapticDiagnosticsListeners = new Set<(diagnostics: HapticDiagnostics) => void>();

function emitHapticDiagnostics(): void {
  const snapshot = getHapticDiagnosticsSnapshot();
  hapticDiagnosticsListeners.forEach(listener => listener(snapshot));
}

function updateHapticDiagnostics(partial: Partial<HapticDiagnostics>): void {
  hapticDiagnostics = {
    ...hapticDiagnostics,
    ...partial,
    lastUpdatedAt: Date.now(),
  };
  emitHapticDiagnostics();
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function shouldBypassMute(
  source: string,
  reason: 'played' | 'focus_completion'
): boolean {
  return source === 'probe' || reason === 'focus_completion';
}

function areHapticsAllowed(
  source: string,
  reason: 'played' | 'focus_completion'
): boolean {
  if (shouldBypassMute(source, reason)) return true;
  return getAppPreferencesSnapshot().hapticsEnabled === true;
}

export function getHapticDiagnosticsSnapshot(): HapticDiagnostics {
  return {
    ...hapticDiagnostics,
    nativeStatus: hapticDiagnostics.nativeStatus ? { ...hapticDiagnostics.nativeStatus } : undefined,
  };
}

export function subscribeToHapticDiagnostics(listener: (diagnostics: HapticDiagnostics) => void): () => void {
  hapticDiagnosticsListeners.add(listener);
  listener(getHapticDiagnosticsSnapshot());
  return () => {
    hapticDiagnosticsListeners.delete(listener);
  };
}

export function refreshNativeHapticStatus(): NativeHapticStatus | undefined {
  if (typeof window === 'undefined' || !window.NativeNotify?.getHapticStatus) {
    const fallbackStatus: NativeHapticStatus = {
      bridgeReady: false,
      hasVibrator: false,
      nativeAvailable: false,
      lastNativeError: null,
    };
    updateHapticDiagnostics({ nativeStatus: fallbackStatus });
    return fallbackStatus;
  }

  try {
    const rawStatus = window.NativeNotify.getHapticStatus();
    const parsedStatus = rawStatus ? JSON.parse(rawStatus) : {};
    const nativeStatus: NativeHapticStatus = {
      bridgeReady: parsedStatus.bridgeReady !== false,
      hasVibrator: !!parsedStatus.hasVibrator,
      nativeAvailable: !!parsedStatus.nativeAvailable,
      lastNativeError: parsedStatus.lastNativeError || null,
    };
    updateHapticDiagnostics({
      nativeStatus,
      lastError: nativeStatus.lastNativeError || hapticDiagnostics.lastError || null,
    });
    return nativeStatus;
  } catch (error) {
    const lastError = `getHapticStatus failed: ${serializeError(error)}`;
    updateHapticDiagnostics({ lastError });
    return hapticDiagnostics.nativeStatus;
  }
}

export async function runHapticDiagnosticProbe(emotion: string = 'warning'): Promise<HapticDiagnostics> {
  refreshNativeHapticStatus();
  triggerHaptic(emotion, 'probe');
  await new Promise(resolve => window.setTimeout(resolve, 120));
  refreshNativeHapticStatus();
  return getHapticDiagnosticsSnapshot();
}

function normalizeEmotionKey(emotion: string): string {
  return emotion.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveEmotion(emotion: string): string | null {
  const normalized = normalizeEmotionKey(emotion);
  const directKey = normalized.replace(/_/g, '');
  if (HAPTIC_PATTERNS[normalized]) return normalized;
  if (HAPTIC_PATTERNS[directKey]) return directKey;
  const aliased = HAPTIC_ALIASES[normalized] || HAPTIC_ALIASES[directKey];
  if (!aliased) return null;
  return HAPTIC_PATTERNS[aliased] ? aliased : null;
}

function getPatternDurationMs(cue: ResolvedHapticCue): number {
  return cue.waveform.timings.reduce((sum, value) => sum + value, 0) + DEFAULT_GAP_MS;
}

function playViaNativeBridge(cue: ResolvedHapticCue): boolean {
  if (typeof window === 'undefined') return false;
  const nativeNotify = window.NativeNotify;
  if (!nativeNotify?.playHapticPattern) return false;

  try {
    nativeNotify.playHapticPattern(JSON.stringify(cue.waveform));
    updateHapticDiagnostics({
      lastBackend: 'native-bridge',
      lastError: null,
    });
    refreshNativeHapticStatus();
    return true;
  } catch (error) {
    const lastError = `Native bridge playback failed: ${serializeError(error)}`;
    console.warn('[HAPTIC] Native bridge playback failed:', error);
    updateHapticDiagnostics({
      lastBackend: 'native-bridge',
      lastError,
    });
    return false;
  }
}

function playViaNavigator(cue: ResolvedHapticCue): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }

  try {
    navigator.vibrate(cue.waveform.timings.slice(1));
    updateHapticDiagnostics({
      lastBackend: 'navigator',
      lastError: null,
    });
    return true;
  } catch (error) {
    console.warn('[HAPTIC] navigator.vibrate failed:', error);
    updateHapticDiagnostics({
      lastBackend: 'navigator',
      lastError: `navigator.vibrate failed: ${serializeError(error)}`,
    });
    return false;
  }
}

function playViaCapacitorFallback(cue: ResolvedHapticCue): void {
  const fallbackPattern = cue.pattern || HAPTIC_PATTERNS[inferSynthesisFamily(cue.patternLabel)];
  updateHapticDiagnostics({
    lastBackend: 'capacitor-fallback',
    lastError: null,
  });
  if (fallbackPattern.fallbackNotificationType) {
    void Haptics.notification({ type: fallbackPattern.fallbackNotificationType }).catch(error => {
      console.warn('[HAPTIC] Notification fallback failed:', error);
      updateHapticDiagnostics({
        lastError: `Capacitor notification fallback failed: ${serializeError(error)}`,
      });
    });
    return;
  }

  void Haptics.impact({ style: fallbackPattern.fallbackStyle || ImpactStyle.Medium }).catch(error => {
    console.warn('[HAPTIC] Impact fallback failed:', error);
    updateHapticDiagnostics({
      lastError: `Capacitor impact fallback failed: ${serializeError(error)}`,
    });
  });
}

function playPatternNow(cue: ResolvedHapticCue): void {
  if (Capacitor.isNativePlatform() && playViaNativeBridge(cue)) {
    return;
  }

  if (playViaNavigator(cue)) {
    return;
  }

  playViaCapacitorFallback(cue);
}

export function recordSkippedHaptic(
  source: string,
  reason: 'missing_marker' | 'unknown_emotion' | 'invalid_custom_pattern' | 'muted_by_user' | 'sleep_quiet_mode',
  rawEmotion?: string | null,
  resolvedEmotion?: string | null,
  cueType?: HapticCueType | null,
  details?: string | null
): void {
  const message = reason === 'unknown_emotion'
    ? 'Haptic marker was present but used an unknown emotion.'
    : reason === 'invalid_custom_pattern'
      ? 'Custom haptic pattern was invalid and no playable fallback could be used.'
      : reason === 'muted_by_user'
        ? 'Haptic playback was skipped because the global haptic switch is disabled.'
        : reason === 'sleep_quiet_mode'
          ? 'Haptic playback was skipped because the user is currently sleeping.'
        : 'No haptic marker detected, so vibration was skipped.';

  appendDiagnosticsLog({
    domain: 'haptic',
    source,
    status: 'skipped',
    message,
    emotion: resolvedEmotion ?? rawEmotion ?? null,
    rawEmotion: rawEmotion ?? null,
    resolvedEmotion: resolvedEmotion ?? null,
    cueType: cueType ?? null,
    markerDetected: reason !== 'missing_marker',
    reason,
    details: details ?? null,
  });
}

function recordPlaybackResult(
  source: string,
  cue: ResolvedHapticCue,
  reason: 'played' | 'focus_completion' = 'played'
): void {
  const snapshot = getHapticDiagnosticsSnapshot();
  const diagnosticsReason = snapshot.lastError
    ? 'native_failed'
    : reason === 'focus_completion'
      ? 'focus_completion'
      : cue.cueType === 'custom'
        ? 'custom_pattern'
        : cue.cueType === 'synthesized'
          ? 'synthesized'
          : 'played';

  const message = snapshot.lastError
    ? `Haptic playback failed: ${snapshot.lastError}`
    : reason === 'focus_completion'
      ? `Focus completion reminder vibration started via ${snapshot.lastBackend || 'unknown'}.`
      : cue.cueType === 'custom'
        ? `Custom haptic pattern started via ${snapshot.lastBackend || 'unknown'}.`
        : cue.cueType === 'synthesized'
          ? `Synthesized haptic pattern started via ${snapshot.lastBackend || 'unknown'}.`
          : `Haptic playback started via ${snapshot.lastBackend || 'unknown'}.`;

  appendDiagnosticsLog({
    domain: 'haptic',
    source,
    status: snapshot.lastError ? 'error' : 'success',
    message,
    emotion: cue.emotion,
    rawEmotion: cue.rawEmotion,
    resolvedEmotion: cue.emotion,
    cueType: cue.cueType,
    backend: snapshot.lastBackend || 'unknown',
    markerDetected: true,
    reason: diagnosticsReason,
  });
}

function cancelCurrentDeviceHaptics(): void {
  try {
    if (typeof window !== 'undefined' && window.NativeNotify?.cancelHaptics) {
      window.NativeNotify.cancelHaptics();
      refreshNativeHapticStatus();
      return;
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }
  } catch (error) {
    console.warn('[HAPTIC] Failed to cancel playback:', error);
  }
}

function stopActivePlayback(): void {
  if (activePlayback) {
    window.clearTimeout(activePlayback.timeoutId);
    activePlayback = null;
  }

  cancelCurrentDeviceHaptics();
}

function startCuePlayback(
  cue: ResolvedHapticCue,
  source: string,
  reason: 'played' | 'focus_completion' = 'played'
): void {
  if (!areHapticsAllowed(source, reason)) {
    stopActivePlayback();
    updateHapticDiagnostics({
      lastEmotion: cue.emotion,
      lastCueType: cue.cueType,
      lastScheduledAt: Date.now(),
      lastError: null,
    });
    recordSkippedHaptic(
      source,
      'muted_by_user',
      cue.rawEmotion,
      cue.emotion,
      cue.cueType,
      'Global haptic switch is OFF. Focus completion and manual probe are the only mute bypass paths.'
    );
    return;
  }

  stopActivePlayback();
  playPatternNow(cue);
  recordPlaybackResult(source, cue, reason);

  activePlayback = {
    cue,
    source,
    timeoutId: window.setTimeout(() => {
      activePlayback = null;
    }, getPatternDurationMs(cue)),
  };
}

function enqueueCue(
  cue: ResolvedHapticCue,
  mode: 'immediate' | 'next-frame',
  source: string,
  reason: 'played' | 'focus_completion' = 'played'
): void {
  pendingPlayback = { cue, source };

  if (mode === 'immediate' || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    pendingPlayback = null;
    startCuePlayback(cue, source, reason);
    return;
  }

  if (pendingFrameId !== null) {
    window.cancelAnimationFrame(pendingFrameId);
  }

  pendingFrameId = window.requestAnimationFrame(() => {
    pendingFrameId = null;
    const nextPlayback = pendingPlayback;
    pendingPlayback = null;
    if (nextPlayback) {
      startCuePlayback(nextPlayback.cue, nextPlayback.source, reason);
    }
  });
}

export function triggerHaptic(
  emotion: string,
  source: string = 'probe',
  reason: 'played' | 'focus_completion' = 'played'
): void {
  const normalizedEmotion = normalizeEmotionKey(emotion);
  if (!normalizedEmotion) {
    console.warn(`[HAPTIC] Unknown emotion: ${emotion}`);
    updateHapticDiagnostics({
      lastEmotion: emotion,
      lastError: `Unknown emotion: ${emotion}`,
      lastScheduledAt: Date.now(),
    });
    recordSkippedHaptic(source, 'unknown_emotion', emotion);
    return;
  }

  const resolvedEmotion = resolveEmotion(normalizedEmotion);
  const cue = resolvedEmotion
    ? buildCueFromCanonical(emotion, resolvedEmotion)
    : synthesizeHapticPattern(emotion);

  updateHapticDiagnostics({
    lastEmotion: cue.emotion,
    lastCueType: cue.cueType,
    lastScheduledAt: Date.now(),
    lastError: null,
  });
  enqueueCue(cue, 'immediate', source, reason);
}

export function extractHapticMarkers(text: string): ParsedHapticMarkers {
  if (!text) {
    return { cleanText: text, cues: [], markerDetected: false, skipReason: 'missing_marker', rawEmotion: null, resolvedEmotion: null };
  }

  let lastCue: ResolvedHapticCue | null = null;
  let lastCueIndex = -1;
  let markerDetected = false;
  let skipReason: ParsedHapticMarkers['skipReason'] = 'missing_marker';
  let rawEmotion: string | null = null;
  let resolvedEmotion: string | null = null;
  let cueType: HapticCueType | null = null;
  let parseError: string | null = null;

  let customMatch: RegExpExecArray | null;
  const customRegex = new RegExp(HAPTIC_CUSTOM_PATTERN_REGEX);
  while ((customMatch = customRegex.exec(text)) !== null) {
    markerDetected = true;
    const parsedCustom = parseCustomPatternDirective(customMatch[1]);
    if (parsedCustom.cue && customMatch.index >= lastCueIndex) {
      lastCue = parsedCustom.cue;
      lastCueIndex = customMatch.index;
      skipReason = null;
      rawEmotion = parsedCustom.cue.rawEmotion;
      resolvedEmotion = parsedCustom.cue.emotion;
      cueType = parsedCustom.cue.cueType;
      parseError = parsedCustom.parseError;
    } else if (!parsedCustom.cue && customMatch.index >= lastCueIndex) {
      const customRawLabel = 'rawLabel' in parsedCustom ? parsedCustom.rawLabel ?? null : null;
      lastCue = null;
      lastCueIndex = customMatch.index;
      skipReason = 'invalid_custom_pattern';
      rawEmotion = customRawLabel;
      resolvedEmotion = null;
      cueType = null;
      parseError = parsedCustom.parseError;
    }
  }

  let markerMatch: RegExpExecArray | null;
  const markerRegex = new RegExp(HAPTIC_MARKER_REGEX);
  while ((markerMatch = markerRegex.exec(text)) !== null) {
    markerDetected = true;
    const rawMarkerEmotion = markerMatch[1];
    const nextCue = resolveEmotion(rawMarkerEmotion)
      ? buildCueFromCanonical(rawMarkerEmotion, resolveEmotion(rawMarkerEmotion)!)
      : synthesizeHapticPattern(rawMarkerEmotion);
    if (markerMatch.index >= lastCueIndex) {
      lastCue = nextCue;
      lastCueIndex = markerMatch.index;
      skipReason = null;
      rawEmotion = nextCue.rawEmotion;
      resolvedEmotion = nextCue.emotion;
      cueType = nextCue.cueType;
      parseError = null;
    }
  }

  const cleanText = text
    .replace(HAPTIC_CUSTOM_PATTERN_REGEX, '')
    .replace(/\[HAPTIC:[^\]]*\]/gi, '')        // 兜底：匹配 [HAPTIC:任意内容]，包括中文逗号等
    .replace(/\[\/?HAPTIC_PATTERN\]/gi, '');   // 兜底：未闭合/孤立的标签

  return {
    cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(),
    cues: lastCue ? [lastCue] : [],
    markerDetected,
    skipReason: lastCue ? null : skipReason,
    rawEmotion: lastCue?.rawEmotion ?? rawEmotion ?? null,
    resolvedEmotion: lastCue?.emotion ?? resolvedEmotion ?? null,
    cueType: lastCue?.cueType ?? cueType ?? null,
    parseError,
  };
}

export function scheduleHapticPlayback(
  cues: ResolvedHapticCue[],
  mode: 'immediate' | 'next-frame' = 'next-frame',
  source: string = 'system',
  reason: 'played' | 'focus_completion' = 'played'
): void {
  if (!cues.length) {
    recordSkippedHaptic(source, 'missing_marker');
    return;
  }
  const cue = cues[cues.length - 1];
  if (cue) {
    updateHapticDiagnostics({
      lastEmotion: cue.emotion,
      lastCueType: cue.cueType,
      lastScheduledAt: Date.now(),
      lastError: null,
    });
  }

  const startPlayback = () => {
    const cue = cues[cues.length - 1];
    if (cue) {
      enqueueCue(cue, 'immediate', source, reason);
    }
  };

  if (mode === 'immediate' || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    startPlayback();
    return;
  }

  const nextCue = cues[cues.length - 1];
  if (!nextCue) return;
  enqueueCue(nextCue, 'next-frame', source, reason);
}

/**
 * 兼容旧调用：立即解析并开始播放，新的情绪会覆盖当前震动。
 * 新逻辑更推荐先 extract，再在 UI 更新后调用 schedule。
 */
export function processHapticMarkers(text: string, source: string = 'system'): string {
  const { cleanText, cues } = extractHapticMarkers(text);
  scheduleHapticPlayback(cues, 'immediate', source);
  return cleanText;
}

export function stripHapticMarkers(text: string): string {
  if (!text) return text;
  return text
    .replace(HAPTIC_CUSTOM_PATTERN_REGEX, '')
    .replace(/\[HAPTIC:[^\]]*\]/gi, '')
    .replace(/\[\/?HAPTIC_PATTERN\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 流式震动检测器：在流式输出过程中实时检测并触发 [HAPTIC:emotion] 标记。
 * 内部维护 buffer 以处理跨 chunk 的标记片段。
 */
export class StreamHapticDetector {
  private buffer: string = '';
  private fired: boolean = false;
  private readonly source: string;
  private lastTriggeredEmotion: string | null = null;

  constructor(source: string = 'chat') {
    this.source = source;
  }

  /**
   * 处理一个流式 chunk。
   * 返回可安全显示的文本（已移除完整标记，保留不完整片段直到确认）。
   */
  processChunk(chunk: string): string {
    this.buffer += chunk;

    // 检测并触发完整的 [HAPTIC:xxx] 标记
    const completeRegex = /\[HAPTIC:([a-z0-9_-]+)\]/gi;
    let match;
    while ((match = completeRegex.exec(this.buffer)) !== null) {
      if (!this.fired) {
        triggerHaptic(match[1], this.source);
        this.fired = true; // 每次流式只触发最后一个标记
        this.lastTriggeredEmotion = resolveEmotion(match[1]) || match[1];
      }
      this.buffer = this.buffer.slice(0, match.index) + this.buffer.slice(match.index + match[0].length);
      completeRegex.lastIndex = match.index; // 重置位置
    }

    const customRegex = /\[HAPTIC_PATTERN\]([\s\S]*?)\[\/HAPTIC_PATTERN\]/gi;
    while ((match = customRegex.exec(this.buffer)) !== null) {
      const parsedCustom = parseCustomPatternDirective(match[1]);
      if (!this.fired && parsedCustom.cue) {
        scheduleHapticPlayback([parsedCustom.cue], 'immediate', this.source);
        this.fired = true;
        this.lastTriggeredEmotion = parsedCustom.cue.emotion;
      } else if (!parsedCustom.cue) {
        const rawLabel = 'rawLabel' in parsedCustom ? parsedCustom.rawLabel ?? null : null;
        recordSkippedHaptic(
          this.source,
          'invalid_custom_pattern',
          rawLabel,
          null,
          null,
          parsedCustom.parseError
        );
      }
      this.buffer = this.buffer.slice(0, match.index) + this.buffer.slice(match.index + match[0].length);
      customRegex.lastIndex = match.index;
    }

    // 检查末尾是否有不完整的 [HAPTIC: 片段
    const partialIndex = this.buffer.lastIndexOf('[HAPTIC:');
    if (partialIndex !== -1 && !this.buffer.substring(partialIndex).includes(']')) {
      // 末尾有不完整标记，只返回它之前的内容
      return this.buffer.substring(0, partialIndex);
    }

    const customPartialIndex = this.buffer.lastIndexOf('[HAPTIC_PATTERN]');
    if (customPartialIndex !== -1 && !this.buffer.substring(customPartialIndex).includes('[/HAPTIC_PATTERN]')) {
      return this.buffer.substring(0, customPartialIndex);
    }

    // 也检查更短的片段如 "[HAPTIC" 或 "[HAPT" 等
    const bracketIndex = this.buffer.lastIndexOf('[');
    if (bracketIndex !== -1) {
      const tail = this.buffer.substring(bracketIndex);
      const looksLikeMarkerPrefix = '[HAPTIC:'.startsWith(tail) && tail.length < '[HAPTIC:'.length;
      const looksLikeCustomPrefix = '[HAPTIC_PATTERN]'.startsWith(tail) && tail.length < '[HAPTIC_PATTERN]'.length;
      if (looksLikeMarkerPrefix || looksLikeCustomPrefix) {
        return this.buffer.substring(0, bracketIndex);
      }
    }

    return this.buffer;
  }

  /**
   * 流结束时调用，处理并返回剩余 buffer 内容。
   */
  flush(): string {
    const { cleanText, cues } = extractHapticMarkers(this.buffer);
    if (!this.fired && cues.length > 0) {
      this.lastTriggeredEmotion = cues[cues.length - 1]?.emotion || null;
      scheduleHapticPlayback(cues, 'immediate', this.source);
    }
    this.buffer = '';
    this.fired = false;
    return cleanText;
  }

  getTriggeredEmotion(): string | null {
    return this.lastTriggeredEmotion;
  }

  /**
   * 重置检测器状态（用于新的流式会话）。
   */
  reset(): void {
    this.buffer = '';
    this.fired = false;
    this.lastTriggeredEmotion = null;
  }
}
