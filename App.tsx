import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { AppView, JournalLog, PersonaConfig, UserStats, GachaItem, LifeLog, LifeEventType, FoodAnalysisResponse, ChatSession, AIConfig, ConnectionProfile, BackupData, CustomPrompts, PromptPreset, MemoryLog, CycleDayLog, NotificationLog, ChatMessage, StreamChunk, StreamDiagnostics, HapticDiagnostics, DiagnosticsLogEntry, AppPreferences } from './types';
import TerminalInput from './components/TerminalInput';
import FocusSession from './components/FocusSession';
import { Settings } from './components/Settings';
import ChatInterface from './components/ChatInterface';
import ShopInterface from './components/ShopInterface';
import BioMonitor from './components/BioMonitor';
import CycleTracker from './components/CycleTracker';
import LogArchive from './components/LogArchive';
import MarkdownText from './components/MarkdownText'; 
import NotificationInbox from './components/NotificationInbox';
import * as GeminiService from './services/geminiService';
import { extractHapticMarkers, scheduleHapticPlayback, StreamHapticDetector, getHapticDiagnosticsSnapshot, subscribeToHapticDiagnostics, runHapticDiagnosticProbe, recordSkippedHaptic, triggerHaptic } from './services/hapticPatterns';
import { appendDiagnosticsLog, clearDiagnosticsLogs, getDiagnosticsLogsSnapshot, normalizeDiagnosticsLogEntry, subscribeToDiagnosticsLogs } from './services/diagnosticsLog';
import { getAppPreferencesSnapshot, setAppPreferences, subscribeToAppPreferences } from './services/appPreferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { RefreshCw, Mail } from 'lucide-react';

// 预设人设配置 (V2.0 Update)
const PRESETS = {
  STRICT: {
    name: "Unit-734 观测者",
    description: "冷酷的效率机器，用绝对的理性鞭策用户。",
    worldLore: "用户是必须通过试炼的个体。",
    voiceTone: "冷漠、数据化、带有高阶智能的讽刺",
    targetSleepTime: "23:00",
    wakeUpTime: "06:00",
    waterReminderMode: 'SMART' as const,
    waterReminderInterval: 45,
    userRole: "用户",
    currentGoal: "完成每日任务",
    memoryRecallLimit: 20,
    journalRecallLimit: 3,
    archiveRecallLimit: 50
  },
  GENTLE: {
    name: "Aegis 辅助者",
    description: "温暖可靠的AI助手，冷静又带有关怀。",
    worldLore: "用户是需要陪伴和督促的个体。",
    voiceTone: "温柔、坚定、保护欲强、像可靠的赛博管家",
    targetSleepTime: "22:30",
    wakeUpTime: "07:30",
    waterReminderMode: 'SMART' as const,
    waterReminderInterval: 45,
    userRole: "用户",
    currentGoal: "保持健康作息",
    memoryRecallLimit: 20,
    journalRecallLimit: 3,
    archiveRecallLimit: 50
  }
};

const DEFAULT_STATS: UserStats = {
  coins: 200,
  san: 80,
  energy: 90,
  unlockedChatTurns: 5,
  lastDrinkTime: Date.now(),
  lastMealTime: 0,
  lastActiveTime: Date.now()
};

// 默认 AI 配置 (优先读取 .env)
const DEFAULT_AI_CONFIG: AIConfig = {
    provider: 'gemini',
    apiKey: process.env.API_KEY || '',
    baseUrl: '',
    modelId: 'gemini-3-flash-preview',
    enableStreaming: true
};

const normalizeOptionalString = (value?: string): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

const normalizeStreamingEnabled = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['false', '0', 'off', 'no', 'disabled'].includes(normalized)) return false;
        if (['true', '1', 'on', 'yes', 'enabled'].includes(normalized)) return true;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    return true;
};

const normalizeAiConfig = (config?: Partial<AIConfig> | null): AIConfig => {
    const mergedConfig: AIConfig = {
        ...DEFAULT_AI_CONFIG,
        ...(config || {}),
        enableStreaming: normalizeStreamingEnabled(config?.enableStreaming)
    };

    const notificationProvider = mergedConfig.notificationProvider;
    if (!notificationProvider) {
        return {
            ...mergedConfig,
            notificationProvider: undefined,
            notificationApiKey: undefined,
            notificationBaseUrl: undefined,
            notificationModelId: undefined,
        };
    }

    return {
        ...mergedConfig,
        notificationProvider,
        notificationApiKey: normalizeOptionalString(mergedConfig.notificationApiKey),
        notificationBaseUrl: notificationProvider === 'gemini'
            ? undefined
            : normalizeOptionalString(mergedConfig.notificationBaseUrl),
        notificationModelId: normalizeOptionalString(mergedConfig.notificationModelId),
    };
};

const normalizeConnectionProfile = (profile: Partial<ConnectionProfile> & Pick<ConnectionProfile, 'id' | 'name'>): ConnectionProfile => ({
    ...normalizeAiConfig(profile),
    id: profile.id,
    name: profile.name
});

const normalizeLifeLogRecord = (log: Partial<LifeLog>): LifeLog => ({
  id: typeof log.id === 'string' && log.id.trim() ? log.id : Date.now().toString(),
  timestamp: typeof log.timestamp === 'number' ? log.timestamp : Date.now(),
  type: (log.type as LifeEventType) || 'WATER',
  value: typeof log.value === 'number' ? log.value : undefined,
  description: typeof log.description === 'string' ? log.description : undefined,
  status: log.status || 'SUCCESS',
  rawInput: typeof log.rawInput === 'string' ? log.rawInput : undefined,
  aiAnalysis: typeof log.aiAnalysis === 'string' ? log.aiAnalysis : undefined,
  coinChange: typeof log.coinChange === 'number' ? log.coinChange : undefined,
});

const LEGACY_WEARABLE_TYPES = new Set(['STEPS', 'HEART_RATE']);

const isLegacyWearableLifeLog = (log: unknown): boolean => {
  if (!log || typeof log !== 'object') return false;
  const candidate = log as Record<string, unknown>;
  const source = typeof candidate.source === 'string' ? candidate.source : '';
  const importKind = typeof candidate.importKind === 'string' ? candidate.importKind : '';
  const type = typeof candidate.type === 'string' ? candidate.type : '';
  return source === 'health_connect'
    || source === 'huawei_health'
    || !!importKind
    || LEGACY_WEARABLE_TYPES.has(type);
};

const LEGACY_TIME_PREFIX_PATTERN = /^\[(\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\]\s*/;

const stripRepeatedLegacyTimePrefixes = (text: string, role: ChatMessage['role']): string => {
  if (role !== 'model' || !text) return text;

  let remaining = text;
  let matchCount = 0;
  while (LEGACY_TIME_PREFIX_PATTERN.test(remaining)) {
    remaining = remaining.replace(LEGACY_TIME_PREFIX_PATTERN, '');
    matchCount += 1;
  }

  return matchCount >= 2 ? remaining.trimStart() : text;
};

const normalizeChatMessageRecord = (message: ChatMessage): ChatMessage => ({
  ...message,
  text: stripRepeatedLegacyTimePrefixes(message.text || '', message.role),
});

const sanitizeStoredLifeLogs = (rawLogs: unknown): LifeLog[] => {
  if (!Array.isArray(rawLogs)) return [];
  return rawLogs
    .filter(log => !isLegacyWearableLifeLog(log))
    .map(log => normalizeLifeLogRecord(log as Partial<LifeLog>));
};

const ENCOURAGEMENTS = {
    WATER: ["咕嘟咕嘟——细胞正在欢呼。","水分补给完成，皮肤会感谢你的。","很好，保持这个节奏，代谢率正在优化。","一杯水，是给身体最简单的情书。","清空焦虑，注入活力。"],
    MEAL: ["已记录能量摄入。"],
    SLEEP: ["辛苦了一天，该断开连接了。","去梦里寻找答案吧，晚安。","休眠舱已开启，在这个世界你很安全。","放下所有任务，此刻只属于你。","在那边（梦境）见。"],
    WAKE_UP: ["欢迎回来，操作员。","系统重启成功。","新的一天，新的数据。"],
    EXERCISE: ["记录完成，多巴胺水平提升。","细胞因子正在被抑制，干得漂亮。","能量转换效率提升了。"]
};

const ENCOURAGEMENT_HAPTICS: Partial<Record<LifeEventType, string>> = {
    WATER: 'gentle',
    MEAL: 'success',
    SLEEP: 'gentle',
    WAKE_UP: 'gentle',
    EXERCISE: 'pride',
};

const Icons = {
  Terminal: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  Focus: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  Shop: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  Settings: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>,
  Bio: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
};

const SegmentedBar = ({ value, colorClass, totalSegments = 10 }: { value: number, colorClass: string, totalSegments?: number }) => {
  const activeSegments = Math.ceil((value / 100) * totalSegments);
  return (
    <div className="flex gap-0.5 h-3">
      {Array.from({ length: totalSegments }).map((_, i) => (
        <div key={i} className={`flex-1 transform skew-x-[-15deg] transition-all duration-300 ${ i < activeSegments ? `${colorClass} shadow-[0_0_5px_currentColor]` : 'bg-gray-800 opacity-30' }`}></div>
      ))}
    </div>
  );
};

const isTimeInRange = (currentMins: number, startMins: number, endMins: number) => {
    if (startMins < endMins) return currentMins >= startMins && currentMins < endMins;
    else return currentMins >= startMins || currentMins < endMins;
};

// Helper: HH:mm to minutes
const timeToMins = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};

// V2.0 Smart Anchor Logic (Enhanced for local intelligence)
const calculateSmartWaterAnchors = (wakeUpTime: string, sleepTime: string): number[] => {
    const wakeMins = timeToMins(wakeUpTime);
    const sleepMins = timeToMins(sleepTime);
    
    // Anchors placed strategically between meals and avoiding pre-sleep
    return [
        (wakeMins + 90) % 1440,   // Post-Breakfast (+1.5h)
        (wakeMins + 210) % 1440,  // Mid-Morning (+3.5h)
        (wakeMins + 390) % 1440,  // Post-Lunch (+6.5h)
        (wakeMins + 510) % 1440,  // Mid-Afternoon (+8.5h)
        (wakeMins + 750) % 1440,  // Post-Dinner (+12.5h)
        (sleepMins - 120 + 1440) % 1440 // Final Hydration (Sleep - 2h)
    ];
};

const isInMealWindow = (currentMins: number, wakeMins: number): boolean => {
    const mealTimes = [
        { start: wakeMins, end: wakeMins + 60 }, // Breakfast
        { start: wakeMins + 270, end: wakeMins + 360 }, // Lunch (+4.5h to +6h)
        { start: wakeMins + 630, end: wakeMins + 720 }  // Dinner (+10.5h to +12h)
    ];
    
    return mealTimes.some(meal => {
        let start = meal.start % 1440;
        let end = meal.end % 1440;
        if (start <= end) {
            return currentMins >= start && currentMins <= end;
        } else {
            return currentMins >= start || currentMins <= end;
        }
    });
};

const calculateOfflineDecay = (stats: UserStats, elapsedMinutes: number): UserStats => {
    let minutesLeft = Math.min(elapsedMinutes, 1440);
    if (minutesLeft <= 0) return stats;

    let energy = stats.energy;
    let san = stats.san;

    // Energy brackets and their corresponding decay rates
    const brackets = [
        { threshold: 90, energyDecay: 0.165, sanDecay: 0.08 }, // energy > 90
        { threshold: 80, energyDecay: 0.15,  sanDecay: 0.08 }, // 80 < energy <= 90
        { threshold: 40, energyDecay: 0.15,  sanDecay: 0.04 }, // 40 < energy <= 80
        { threshold: 30, energyDecay: 0.15,  sanDecay: 0.08 }, // 30 < energy <= 40
        { threshold: 0,  energyDecay: 0.15,  sanDecay: 0.32 }, // 0 < energy <= 30
    ];

    while (minutesLeft > 0 && (energy > 0 || san > 0)) {
        let currentBracket;
        if (energy > 90)      currentBracket = brackets[0];
        else if (energy > 80) currentBracket = brackets[1];
        else if (energy > 40) currentBracket = brackets[2];
        else if (energy > 30) currentBracket = brackets[3];
        else                  currentBracket = brackets[4];
        
        const energyToNextThreshold = energy - currentBracket.threshold;
        const minutesToNextThreshold = (energyToNextThreshold > 0 && currentBracket.energyDecay > 0)
            ? (energyToNextThreshold / currentBracket.energyDecay)
            : Infinity;
        
        const minutesToDepleteEnergy = (energy > 0 && currentBracket.energyDecay > 0)
            ? (energy / currentBracket.energyDecay)
            : Infinity;

        const minutesInStep = Math.min(minutesLeft, minutesToNextThreshold, minutesToDepleteEnergy);
        
        if (minutesInStep <= 0 || minutesInStep === Infinity) {
            const finalSanDecay = energy <= 30 ? brackets[4].sanDecay : brackets[3].sanDecay;
            san -= finalSanDecay * minutesLeft;
            break; 
        }
        
        const timeChunk = Math.ceil(minutesInStep);
        const actualMinutesInStep = Math.min(minutesLeft, timeChunk);
        
        energy -= currentBracket.energyDecay * actualMinutesInStep;
        san -= currentBracket.sanDecay * actualMinutesInStep;
        minutesLeft -= actualMinutesInStep;
    }
    
    return { ...stats, energy: parseFloat(Math.max(0, energy).toFixed(1)), san: parseFloat(Math.max(0, san).toFixed(1)) };
};

const isValidNumber = (val: any, fallback = 0): number => {
    const num = Number(val);
    return (typeof num === 'number' && !isNaN(num)) ? num : fallback;
};

// Navigation State Definition
interface NavState {
    view: AppView;
    // Chat Sub-states
    chatSessionId: string | null;
    isChatMemoryBankOpen: boolean;
    isChatManualMemoryOpen: boolean;
    // Bio Sub-states
    bioSelectedLog: LifeLog | null;
    isBioFoodInputOpen: boolean;
    // Shop Sub-states
    shopGachaResult: { item: string; text: string } | null;
}

const DEFAULT_NAV: NavState = {
    view: AppView.DASHBOARD,
    chatSessionId: null,
    isChatMemoryBankOpen: false,
    isChatManualMemoryOpen: false,
    bioSelectedLog: null,
    isBioFoodInputOpen: false,
    shopGachaResult: null
};

const OVERSEER_SESSION_ID = 'system_core_overseer';
const LEGACY_OVERSEER_NAME = '[SYSTEM_CORE_OVERSEER]';
const DEFAULT_OVERSEER_NAME = 'Overseer';

const normalizeChatSessionRecord = (session: ChatSession): ChatSession => ({
  ...session,
  name: session.id === OVERSEER_SESSION_ID && session.name === LEGACY_OVERSEER_NAME
    ? DEFAULT_OVERSEER_NAME
    : session.name,
  messages: Array.isArray(session.messages)
    ? session.messages.map(normalizeChatMessageRecord)
    : [],
});

export default function App() {
  // Navigation History Stack
  const [navHistory, setNavHistory] = useState<NavState[]>([DEFAULT_NAV]);
  const currentNav = navHistory[navHistory.length - 1];

  const [persona, setPersona] = useState<PersonaConfig>(PRESETS.GENTLE); 
  const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [prompts, setPrompts] = useState<CustomPrompts>(GeminiService.DEFAULT_PROMPTS); 
  const [appPreferences, setAppPreferencesState] = useState<AppPreferences>(() => getAppPreferencesSnapshot());
  const [savedConnectionProfiles, setSavedConnectionProfiles] = useState<ConnectionProfile[]>([]);
  const [savedPresets, setSavedPresets] = useState<PersonaConfig[]>([]); 
  const [savedPromptPresets, setSavedPromptPresets] = useState<PromptPreset[]>([]); 
  const [stats, setStats] = useState<UserStats>(DEFAULT_STATS);
  const [logs, setLogs] = useState<JournalLog[]>([]);
  const [memoryBank, setMemoryBank] = useState<MemoryLog[]>([]); 
  const [lifeLogs, setLifeLogs] = useState<LifeLog[]>([]); 
  const [gachaItems, setGachaItems] = useState<GachaItem[]>([]); 
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [cycleDayLogs, setCycleDayLogs] = useState<CycleDayLog[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]); // New State for Notification Inbox
  const [streamDiagnostics, setStreamDiagnostics] = useState<StreamDiagnostics>(() => GeminiService.getStreamDiagnosticsSnapshot());
  const [hapticDiagnostics, setHapticDiagnostics] = useState<HapticDiagnostics>(() => getHapticDiagnosticsSnapshot());
  const [foregroundDiagnosticsLogs, setForegroundDiagnosticsLogs] = useState<DiagnosticsLogEntry[]>(() => getDiagnosticsLogsSnapshot());
  const [backgroundDiagnosticsLogs, setBackgroundDiagnosticsLogs] = useState<DiagnosticsLogEntry[]>([]);
  const [isStreamProbeRunning, setIsStreamProbeRunning] = useState(false);
  const [isHapticProbeRunning, setIsHapticProbeRunning] = useState(false);
  const activeStreamingTurnRef = useRef<{ sessionId: string; cancelled: boolean } | null>(null);
  const [activeStreamingSessionId, setActiveStreamingSessionId] = useState<string | null>(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBioAnalyzing, setIsBioAnalyzing] = useState(false); 
  const [foodAnalysisResult, setFoodAnalysisResult] = useState<FoodAnalysisResponse | null>(null);
  const [notification, setNotification] = useState<{title: string, content: string} | null>(null);
  const [isFocusActive, setIsFocusActive] = useState(false); 
  const [proactiveMessage, setProactiveMessage] = useState<string | null>(null);
  const [isNotificationInboxOpen, setIsNotificationInboxOpen] = useState(false); // New UI State

  const lastNagTimeRef = useRef<number>(0);
  const nextSleepNagIntervalRef = useRef<number>((Math.floor(Math.random() * 6) + 5) * 60 * 1000); // 5-10 mins
  const lastAutoCheckTimeRef = useRef<number>(0); // 心跳去重：防止原生闹钟与 JS interval 同时触发
  const lastInteractionTimeRef = useRef<number>(0);
  const lastWaterReminderRef = useRef<number>(0);
  const lastExerciseReminderRef = useRef<number>(0);
  const lastMealReminderRef = useRef<number>(0);
  // Always reflects the latest stats, even inside async closures (tool calls).
  const statsRef = useRef<UserStats>(stats);
  statsRef.current = stats;

  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [logToDelete, setLogToDelete] = useState<string | null>(null);
  const [isWakeUpModalOpen, setIsWakeUpModalOpen] = useState(false);
  const [wakeFeeling, setWakeFeeling] = useState('');

  const isSleeping = useMemo(() => {
    const lastSleepOrWake = [...lifeLogs].sort((a, b) => b.timestamp - a.timestamp).find(l => l.type === 'SLEEP' || l.type === 'WAKE_UP');
    return lastSleepOrWake?.type === 'SLEEP';
  }, [lifeLogs]);

  useEffect(() => {
    const unsubscribeStreamDiagnostics = GeminiService.subscribeToStreamDiagnostics(setStreamDiagnostics);
    const unsubscribeHapticDiagnostics = subscribeToHapticDiagnostics(setHapticDiagnostics);
    const unsubscribeDiagnosticsLogs = subscribeToDiagnosticsLogs(setForegroundDiagnosticsLogs);
    const unsubscribeAppPreferences = subscribeToAppPreferences(setAppPreferencesState);
    return () => {
      unsubscribeStreamDiagnostics();
      unsubscribeHapticDiagnostics();
      unsubscribeDiagnosticsLogs();
      unsubscribeAppPreferences();
    };
  }, []);

  useEffect(() => {
    if (appPreferences.hapticsEnabled) return;

    try {
      if ((window as any).NativeNotify?.cancelHaptics) {
        (window as any).NativeNotify.cancelHaptics();
      } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(0);
      }
    } catch (error) {
      console.warn('[HAPTIC] Failed to cancel active playback after muting:', error);
    }
  }, [appPreferences.hapticsEnabled]);

  const refreshBackgroundDiagnosticsLogs = () => {
      if (!Capacitor.isNativePlatform()) return;

    try {
      const rawLogs = (window as any).NativeNotify?.getBackgroundDiagnosticsLog?.();
      if (!rawLogs) {
        setBackgroundDiagnosticsLogs([]);
        return;
      }
      const parsedLogs = JSON.parse(rawLogs);
      if (!Array.isArray(parsedLogs)) {
        setBackgroundDiagnosticsLogs([]);
        return;
      }

      const normalizedLogs = parsedLogs
        .filter((entry): entry is Partial<DiagnosticsLogEntry> => !!entry && typeof entry === 'object')
        .filter(entry => typeof entry.domain === 'string' && typeof entry.source === 'string' && typeof entry.status === 'string' && typeof entry.message === 'string')
        .map(entry => normalizeDiagnosticsLogEntry(entry as DiagnosticsLogEntry));
      setBackgroundDiagnosticsLogs(normalizedLogs);
    } catch (error) {
      appendDiagnosticsLog({
        domain: 'bg_notification',
        source: 'native_bridge',
        status: 'error',
        message: 'Failed to read Android background diagnostics log.',
        details: error instanceof Error ? error.message : String(error),
      });
      setBackgroundDiagnosticsLogs([]);
    }
  };

  const handleClearDiagnosticsLogs = () => {
    clearDiagnosticsLogs();
    setBackgroundDiagnosticsLogs([]);
    if (Capacitor.isNativePlatform()) {
      try {
        (window as any).NativeNotify?.clearBackgroundDiagnosticsLog?.();
      } catch (error) {
        console.warn('[DIAGNOSTICS] Failed to clear Android background logs:', error);
      }
    }
  };

  useEffect(() => {
    refreshBackgroundDiagnosticsLogs();
  }, []);

  useEffect(() => {
    if (currentNav.view === AppView.SETTINGS) {
      refreshBackgroundDiagnosticsLogs();
    }
  }, [currentNav.view]);

  const diagnosticsLogs = useMemo(
    () => [...foregroundDiagnosticsLogs, ...backgroundDiagnosticsLogs].sort((a, b) => b.timestamp - a.timestamp),
    [foregroundDiagnosticsLogs, backgroundDiagnosticsLogs]
  );

  // Navigation Helpers
  const navigate = (updates: Partial<NavState>) => {
      setNavHistory(prev => {
          const current = prev[prev.length - 1];
          // Create new state merging current with updates
          return [...prev, { ...current, ...updates }];
      });
  };

  const switchMainView = (newView: AppView) => {
      // When switching main tabs, we push a clean state for that view
      // This maintains history of tabs visited, or you could replace stack if desired.
      // Standard Android behavior usually keeps history or clears it. 
      // Let's simple push to allow back button to go back to previous tab.
      navigate({ 
          ...DEFAULT_NAV, 
          view: newView 
      });
  };

  const goBack = () => {
      if (navHistory.length > 1) {
          setNavHistory(prev => prev.slice(0, -1));
      } else {
          CapacitorApp.exitApp();
      }
  };

  // Handle Android Hardware Back Button
  useEffect(() => {
      let backListener: any;
      const setupBackListener = async () => {
          backListener = await CapacitorApp.addListener('backButton', ({ canGoBack }) => {
              // 1. Close Global Interruption Modals (Priority)
              if (isWakeUpModalOpen) {
                  setIsWakeUpModalOpen(false);
                  return;
              }
              if (isNotificationInboxOpen) {
                  setIsNotificationInboxOpen(false);
                  return;
              }
              if (logToDelete) {
                  setLogToDelete(null);
                  return;
              }
              if (foodAnalysisResult) {
                  setFoodAnalysisResult(null);
                  return;
              }

              // 2. Focus Protection
              if (currentNav.view === AppView.FOCUS && isFocusActive) {
                   // If focus is active, back button usually shouldn't do anything or warn
                   // For now, let's just ignore or let it go back (which triggers abort logic in component)
                   switchMainView(AppView.DASHBOARD);
                   return;
              }

              // 3. Navigation Stack
              goBack();
          });
      };
      
      setupBackListener();

      return () => {
          if (backListener) {
              backListener.remove();
          }
      };
  }, [navHistory, isWakeUpModalOpen, logToDelete, foodAnalysisResult, isFocusActive, isNotificationInboxOpen]);

  const todayBioLogs = useMemo(() => {
    const lastWakeUp = [...lifeLogs].filter(l => l.type === 'WAKE_UP').sort((a, b) => b.timestamp - a.timestamp)[0];
    if (lastWakeUp) return lifeLogs.filter(log => log.timestamp >= lastWakeUp.timestamp);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return lifeLogs.filter(log => log.timestamp >= startOfToday.getTime());
  }, [lifeLogs]);
  const healthContextSummary = useMemo(() => GeminiService.buildTodayHealthContextSummary(todayBioLogs), [todayBioLogs]);

  useEffect(() => {
    const initNotifications = async () => {
        if (Capacitor.isNativePlatform()) {
            const perm = await LocalNotifications.checkPermissions();
            if (perm.display !== 'granted') await LocalNotifications.requestPermissions();
            const pending = await LocalNotifications.getPending();
            if (pending.notifications.length > 0) await LocalNotifications.cancel(pending);
        } else if (typeof Notification !== 'undefined' && 'requestPermission' in Notification) {
            Notification.requestPermission().catch(e => console.log("Web notification perm failed", e));
        }
    };
    initNotifications();
  }, []);

  // Native Heartbeat Bridge: Expose a function to be called by Android Java
  //const autoCheckRef = useRef<() => Promise<void>>(null);


  const scheduleParsedHaptics = (
    parsed: ReturnType<typeof extractHapticMarkers>,
    source: string,
    mode: 'immediate' | 'next-frame' = 'next-frame',
    options: { suppressPlayback?: boolean; reason?: 'played' | 'focus_completion' } = {}
  ) => {
    if (!parsed.cues.length) {
      const reason = parsed.skipReason === 'invalid_custom_pattern'
        ? 'invalid_custom_pattern'
        : parsed.skipReason === 'unknown_emotion'
          ? 'unknown_emotion'
          : 'missing_marker';
      recordSkippedHaptic(source, reason, parsed.rawEmotion, parsed.resolvedEmotion, parsed.cueType, parsed.parseError);
      return;
    }

    if (options.suppressPlayback) {
      return;
    }

    scheduleHapticPlayback(parsed.cues, mode, source, options.reason);
  };

  const showNotification = useCallback(async (
    title: string,
    body: string,
    options: { hapticEmotion?: string; source?: string; suppressHaptics?: boolean } = {}
  ) => {
  // 过滤 AI 工具调用标记和 Markdown 符号
  let rawBody = body
    .replace(/<调用工具:.*?>/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim();
  if (!rawBody) return;

  if (options.hapticEmotion) {
    rawBody = `${rawBody} [HAPTIC:${options.hapticEmotion}]`;
  }

  const parsedHaptics = extractHapticMarkers(rawBody);
  let cleanBody = parsedHaptics.cleanText;
  if (!cleanBody) return;

  const newNotifLog: NotificationLog = {
    id: Date.now().toString() + Math.random().toString().slice(2, 5),
    timestamp: Date.now(),
    title,
    content: cleanBody,
    read: false
  };

  flushSync(() => {
    setNotification({ title, content: cleanBody });
    setNotificationLogs(prev => [newNotifLog, ...prev]);
  });

  setTimeout(() => setNotification(null), 8000);
  if (isSleeping) {
    if (parsedHaptics.markerDetected || parsedHaptics.cues.length > 0) {
      recordSkippedHaptic(
        options.source || 'foreground_notification',
        'sleep_quiet_mode',
        parsedHaptics.rawEmotion,
        parsedHaptics.resolvedEmotion,
        parsedHaptics.cueType,
        'Notification/message was generated while the user is sleeping.'
      );
    }
    return;
  }

  scheduleParsedHaptics(parsedHaptics, options.source || 'foreground_notification', 'next-frame', {
    suppressPlayback: options.suppressHaptics,
  });

  // 【关键修改】在原生平台上优先使用自定义通知桥
  if (Capacitor.isNativePlatform()) {
    try {
      // 检查 NativeNotify 对象是否存在（由 MainActivity 注入）
      if ((window as any).NativeNotify) {
        (window as any).NativeNotify.postNotification(title, cleanBody);
        return; // 发送成功，直接返回
      } else {
        console.warn('NativeNotify not available, falling back to Capacitor');
      }
    } catch (e) {
      console.error('Native notification failed', e);
    }
  }

  // 降级方案：使用 Capacitor LocalNotifications（Web 或 NativeNotify 不可用时）
  if (Capacitor.isNativePlatform()) {
    try {
      const safeId = Math.floor(Date.now() % 2147483647);
      await LocalNotifications.schedule({
        notifications: [{
          title,
          body: cleanBody,
          id: safeId,
          channelId: 'high_importance_channel'
        }]
      });
    } catch (e) {
      console.error("Local notification failed", e);
    }
  } else if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
    try {
      new Notification(title, { body: cleanBody });
    } catch (e) { }
  }
}, [isSleeping]);

  const handleDismissNotification = (id: string) => {
      setNotificationLogs(prev => prev.filter(n => n.id !== id));
  };

  const handleToggleBookmark = (id: string) => {
      setNotificationLogs(prev => prev.map(n => n.id === id ? { ...n, isBookmarked: !n.isBookmarked } : n));
  };

  const handleClearAllNotifications = () => {
      setNotificationLogs(prev => prev.filter(n => n.isBookmarked));
      showNotification("SYSTEM", "Unsaved notification buffer flushed.");
  };

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
        // Create high importance channel for banners
        LocalNotifications.createChannel({
            id: 'high_importance_channel',
            name: 'High Importance Notifications',
            description: 'Used for urgent AI alerts',
            importance: 5, // 5 = HIGH (Banner + Sound)
            visibility: 1, // 1 = PUBLIC
            vibration: false
        }).catch(e => console.error("Failed to create channel", e));

        LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
            console.log('Notification action performed', notification);
            // Force a small state update or navigation to ensure WebView renders
            setProactiveMessage(null);
            // Optional: navigate to a specific view if needed
        });
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = async () => {
        if (document.hidden) {
            // 关键修复：当应用进入后台时，强制失去焦点并清除选区
            // 这可以防止 WebView 尝试在后台同步剪切板状态，从而避免被 Android 系统拦截或杀后台
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            window.getSelection()?.removeAllRanges();
        } else if (!document.hidden && Capacitor.isNativePlatform()) {
            // When app comes back to foreground, clear any pending "offline" alerts just in case
            await LocalNotifications.cancel({ notifications: [{ id: 99901 }, { id: 99902 }] });
        }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [persona, isSleeping]);

  useEffect(() => {
    const savedPersona = localStorage.getItem('persona'), savedAiConfig = localStorage.getItem('ai_settings'), savedProfiles = localStorage.getItem('connection_profiles'), savedStatsStr = localStorage.getItem('stats'), savedLogs = localStorage.getItem('logs'), savedLifeLogs = localStorage.getItem('lifeLogs'), savedItems = localStorage.getItem('gachaItems'), savedPresetsData = localStorage.getItem('savedPresets'), savedChatSessions = localStorage.getItem('chatSessions'), savedPrompts = localStorage.getItem('custom_prompts'), savedPromptPresetsData = localStorage.getItem('saved_prompt_presets'), savedMemoryBank = localStorage.getItem('memoryBank'), savedCycleDayLogs = localStorage.getItem('cycleDayLogs'), savedNotificationLogs = localStorage.getItem('notificationLogs');
    
    if (savedPersona) {
        const parsed = JSON.parse(savedPersona);
        setPersona({
            ...PRESETS.GENTLE, 
            ...parsed,
            waterReminderMode: parsed.waterReminderMode || 'SMART',
            waterReminderInterval: parsed.waterReminderInterval || 45,
            userRole: parsed.userRole || '',
            currentGoal: parsed.currentGoal || '',
            memoryRecallLimit: parsed.memoryRecallLimit ?? 20,
            journalRecallLimit: parsed.journalRecallLimit ?? 3
        });
    }

    if (savedAiConfig) setAiConfig(normalizeAiConfig(JSON.parse(savedAiConfig))); else setAiConfig(DEFAULT_AI_CONFIG);
    if (savedProfiles) setSavedConnectionProfiles(JSON.parse(savedProfiles).map(normalizeConnectionProfile));
    if (savedPrompts) setPrompts({ ...GeminiService.DEFAULT_PROMPTS, ...JSON.parse(savedPrompts) }); 
    
    if (savedStatsStr) {
        const parsedStats: UserStats = JSON.parse(savedStatsStr);
        const lastTime = parsedStats.lastActiveTime || Date.now(), now = Date.now(), elapsedMinutes = Math.floor((now - lastTime) / 60000);
        let newStats = elapsedMinutes > 5 ? calculateOfflineDecay(parsedStats, elapsedMinutes) : parsedStats;
        setStats({ ...newStats, coins: isValidNumber(newStats.coins), san: isValidNumber(newStats.san), energy: isValidNumber(newStats.energy), unlockedChatTurns: isValidNumber(newStats.unlockedChatTurns), lastActiveTime: now });
    } else { setStats(DEFAULT_STATS); }
    if (savedLogs) setLogs(JSON.parse(savedLogs));
    if (savedMemoryBank) setMemoryBank(JSON.parse(savedMemoryBank)); // Load memory bank
    if (savedLifeLogs) setLifeLogs(sanitizeStoredLifeLogs(JSON.parse(savedLifeLogs)));
    if (savedCycleDayLogs) setCycleDayLogs(JSON.parse(savedCycleDayLogs));
    if (savedItems) setGachaItems(JSON.parse(savedItems));
    if (savedPresetsData) setSavedPresets(JSON.parse(savedPresetsData));
    if (savedPromptPresetsData) setSavedPromptPresets(JSON.parse(savedPromptPresetsData));
    if (savedChatSessions) setChatSessions(JSON.parse(savedChatSessions).map(normalizeChatSessionRecord));
    if (savedNotificationLogs) setNotificationLogs(JSON.parse(savedNotificationLogs));
  }, []);

  useEffect(() => {
    localStorage.setItem('stats', JSON.stringify({ ...stats, lastActiveTime: Date.now() }));
    localStorage.setItem('logs', JSON.stringify(logs));
    localStorage.setItem('memoryBank', JSON.stringify(memoryBank)); // Save memory bank
    localStorage.setItem('lifeLogs', JSON.stringify(lifeLogs));
    localStorage.setItem('cycleDayLogs', JSON.stringify(cycleDayLogs));
    localStorage.setItem('persona', JSON.stringify(persona));
    localStorage.setItem('ai_settings', JSON.stringify(aiConfig)); 
    localStorage.setItem('connection_profiles', JSON.stringify(savedConnectionProfiles));
    localStorage.setItem('gachaItems', JSON.stringify(gachaItems));
    localStorage.setItem('savedPresets', JSON.stringify(savedPresets));
    localStorage.setItem('chatSessions', JSON.stringify(chatSessions));
    localStorage.setItem('custom_prompts', JSON.stringify(prompts));
    localStorage.setItem('saved_prompt_presets', JSON.stringify(savedPromptPresets)); 
    localStorage.setItem('notificationLogs', JSON.stringify(notificationLogs));
  }, [stats, logs, memoryBank, lifeLogs, cycleDayLogs, persona, aiConfig, savedConnectionProfiles, gachaItems, savedPresets, chatSessions, prompts, savedPromptPresets, notificationLogs]);
  
  // 【核心新增】将关键配置同步到 Android Native 层 (SharedPreferences)
  // 这样 KeepAliveService 在后台可以独立工作，不依赖 WebView
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!(window as any).NativeNotify?.syncConfig) return;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const exercisedToday = lifeLogs.some(l => l.type === 'EXERCISE' && l.timestamp >= todayStart.getTime());

    const configToSync = {
      // 人设
      personaName: persona.name,
      voiceTone: persona.voiceTone,
      targetSleepTime: persona.targetSleepTime,
      wakeUpTime: persona.wakeUpTime,
      // AI 配置
      provider: aiConfig.provider,
      apiKey: aiConfig.apiKey,
      modelId: aiConfig.modelId,
      baseUrl: aiConfig.baseUrl || '',
      // 通知专用 AI 配置
      notificationProvider: aiConfig.notificationProvider || '',
      notificationApiKey: aiConfig.notificationApiKey || '',
      notificationModelId: aiConfig.notificationModelId || '',
      notificationBaseUrl: aiConfig.notificationBaseUrl || '',
      // 通知 prompt 模板
      notificationPrompt: prompts.notification || '',
      proactivePrompt: prompts.proactiveCheck || '',
      // 动态状态
      isSleeping: !!isSleeping,
      lastDrinkTime: stats.lastDrinkTime,
      lastMealTime: stats.lastMealTime || 0,
      energy: stats.energy,
      exercisedToday: exercisedToday,
      hapticsEnabled: appPreferences.hapticsEnabled === true,
      healthContextSummary,
    };

    try {
      (window as any).NativeNotify.syncConfig(JSON.stringify(configToSync));
      console.log('[NATIVE_SYNC] Config synced to native layer');
    } catch (e) {
      console.warn('[NATIVE_SYNC] Failed to sync config:', e);
    }
  }, [
    persona,
    aiConfig,
    prompts.notification,
    prompts.proactiveCheck,
    isSleeping,
    stats.lastDrinkTime,
    stats.energy,
    lifeLogs,
    appPreferences.hapticsEnabled,
    healthContextSummary
  ]);

  useEffect(() => {
    const metabolismTimer = setInterval(() => {
        const { isSleepTime } = checkSleepStatus();
        const isStayingUpLate = isSleepTime && !isSleeping;
        setStats(prevStats => {
            let energyDecay = 0.15, sanDecay = 0.08;
            if (prevStats.energy < 30) sanDecay *= 4.0; else if (prevStats.energy > 90) energyDecay *= 1.1; else if (prevStats.energy >= 40 && prevStats.energy <= 80) sanDecay *= 0.5;
            if (isStayingUpLate) { energyDecay *= 2; sanDecay *= 2; }
            const newEnergy = Math.max(0, prevStats.energy - energyDecay), newSan = Math.max(0, prevStats.san - sanDecay);
            return { ...prevStats, energy: parseFloat(newEnergy.toFixed(2)), san: parseFloat(newSan.toFixed(2)), lastActiveTime: Date.now() };
        });
    }, 60000); 
    return () => clearInterval(metabolismTimer);
  }, [isSleeping, persona.targetSleepTime]); 

  const checkSleepStatus = (): { isSleepTime: boolean, overtimeMins: number } => {
    if (!persona.targetSleepTime || !persona.wakeUpTime) return { isSleepTime: false, overtimeMins: 0 };
    const now = new Date(), currentMins = now.getHours() * 60 + now.getMinutes(), [startH, startM] = persona.targetSleepTime.split(':').map(Number), startMins = startH * 60 + startM, [endH, endM] = persona.wakeUpTime.split(':').map(Number), endMins = endH * 60 + endM;
    if (!isTimeInRange(currentMins, startMins, endMins)) return { isSleepTime: false, overtimeMins: 0 };
    let overtime = 0;
    if (currentMins >= startMins) overtime = currentMins - startMins; else overtime = (24 * 60 - startMins) + currentMins;
    return { isSleepTime: true, overtimeMins: overtime };
  };

  useEffect(() => {
    const autoCheck = async () => {
		console.log("[AUTO_CHECK] 开始执行，时间:", new Date().toLocaleTimeString());
        const now = Date.now();
        lastAutoCheckTimeRef.current = now; // 记录执行时间用于心跳去重
        const currentMins = new Date(now).getHours() * 60 + new Date(now).getMinutes();
        
        // 1. 睡眠逻辑 (本地判断)
        const { isSleepTime, overtimeMins } = checkSleepStatus();
        // 只有在睡眠时间、且未处于休眠模式、且距离上次提醒超过随机间隔(5-10分钟)时，才调用AI
        if (isSleepTime && !isSleeping && now - lastNagTimeRef.current > nextSleepNagIntervalRef.current) {
            lastNagTimeRef.current = now;
            nextSleepNagIntervalRef.current = (Math.floor(Math.random() * 6) + 5) * 60 * 1000; // 重新随机 5-10 分钟
            const overtimeStr = `${Math.floor(overtimeMins / 60)}小时${overtimeMins % 60}分`;
            console.log("[AI_TRIGGER] 触发睡眠提醒调用...");
            try {
                const msg = await GeminiService.generateToxicNotification('sleep', persona, aiConfig, prompts, overtimeStr);
                showNotification(`[${persona.name.split(' ')[0]}] 强制指令`, msg);
            } catch (e) { console.error(e); }
        }

        // 2. 喝水逻辑 (本地判断)
        if (!isSleeping && persona.waterReminderMode !== 'OFF') {
             const minsSinceLastDrink = (now - stats.lastDrinkTime) / 60000;
             const minsSinceLastReminder = (now - lastWaterReminderRef.current) / 60000;
             let shouldRemind = false;

             if (persona.waterReminderMode === 'SMART') {
                 const wakeMins = timeToMins(persona.wakeUpTime);
                 const sleepMins = timeToMins(persona.targetSleepTime);
                 const anchors = calculateSmartWaterAnchors(persona.wakeUpTime, persona.targetSleepTime);
                 
                 // 检查是否在锚点附近 (10分钟窗口)
                 const isNearAnchor = anchors.some(anchor => {
                    let diff = Math.abs(currentMins - anchor);
                    if (diff > 720) diff = 1440 - diff; 
                    return diff <= 10;
                 });

                 // 统计今日已喝水次数
                 const todayStart = new Date().setHours(0,0,0,0);
                 const drinksToday = lifeLogs.filter(l => l.type === 'WATER' && l.timestamp >= todayStart).length;

                 // 智能判断逻辑：
                 // 1. 必须在锚点附近
                 // 2. 距离上次喝水超过 60 分钟
                 // 3. 距离上次提醒超过 90 分钟
                 // 4. 不在饭点 (Meal Window)
                 // 5. 不在睡前 1 小时内
                 // 6. 今日喝水目标未达成 (假设目标为 8 杯)
                 const isPreSleep = Math.abs(currentMins - sleepMins) < 60 || (sleepMins - currentMins + 1440) % 1440 < 60;
                 
                 if (isNearAnchor && 
                     minsSinceLastDrink > 60 && 
                     minsSinceLastReminder > 90 && 
                     !isInMealWindow(currentMins, wakeMins) && 
                     !isPreSleep && 
                     drinksToday < 8) {
                     shouldRemind = true;
                 }
             } else if (persona.waterReminderMode === 'INTERVAL') {
                 const interval = persona.waterReminderInterval || 45;
                 if (minsSinceLastDrink > interval && minsSinceLastReminder > interval) {
                     shouldRemind = true;
                 }
             }

             if (shouldRemind) {
                 lastWaterReminderRef.current = now;
                 console.log("[AI_TRIGGER] 触发喝水提醒调用...");
                 try {
                     const msg = await GeminiService.generateToxicNotification('water', persona, aiConfig, prompts);
                     showNotification(`[${persona.name.split(' ')[0]}] 生理警报`, msg);
                 } catch (e) { console.error(e); }
             }
        }

        // 3. 运动逻辑 (睡前 2-4 小时检测)
        const sleepMins = timeToMins(persona.targetSleepTime);
        const minsToSleep = (sleepMins - currentMins + 1440) % 1440;
        if (!isSleeping && minsToSleep <= 240 && minsToSleep >= 120) {
            const todayStart = new Date().setHours(0,0,0,0);
            const exercisedToday = lifeLogs.some(l => l.type === 'EXERCISE' && l.timestamp >= todayStart);
            // 每天只提醒一次
            if (!exercisedToday && lastExerciseReminderRef.current < todayStart) {
                lastExerciseReminderRef.current = now;
                console.log("[AI_TRIGGER] 触发运动提醒调用...");
                try {
                    const msg = await GeminiService.generateToxicNotification('exercise', persona, aiConfig, prompts);
                    showNotification(`[${persona.name.split(' ')[0]}] 运动指令`, msg);
                } catch (e) { console.error(e); }
            }
        }

        // 4. 吃饭/能量逻辑 (能量低于 30)
        if (!isSleeping && stats.energy <= 30 && now - lastMealReminderRef.current > 120 * 60 * 1000) { // 2小时内不重复提醒
            lastMealReminderRef.current = now;
            console.log("[AI_TRIGGER] 触发进食/能量提醒调用...");
            try {
                const msg = await GeminiService.generateToxicNotification('food', persona, aiConfig, prompts);
                showNotification(`[${persona.name.split(' ')[0]}] 能量警报`, msg);
            } catch (e) { console.error(e); }
        }

    };
    //(autoCheckRef as any).current = autoCheck;
    const intervalId = setInterval(autoCheck, 60000); 
    // 【新增这三行代码】：直接把原生的心跳和最新鲜的 autoCheck 绑定！
    (window as any).onNativeHeartbeat = () => {
        const now = Date.now();
        // 心跳去重：如果距离上次 autoCheck 不到 30 秒，跳过（避免与 setInterval 重复触发）
        if (now - lastAutoCheckTimeRef.current < 30000) {
            console.log("[HEARTBEAT] 跳过，距上次检查不到30秒");
            return;
        }
        console.log("【前端强行唤醒】执行后台生理检测...时间：", new Date().toLocaleTimeString());
        autoCheck();
    };

    return () => {
        clearInterval(intervalId);
        // 清理绑定
        delete (window as any).onNativeHeartbeat;
    };
  }, [persona, logs, lifeLogs, aiConfig, isSleeping, stats.lastDrinkTime, prompts, todayBioLogs, cycleDayLogs]);

  const handleUpdateLog = (logId: string, newContent: string) => { setLogs(prev => prev.map(log => log.id === logId ? { ...log, content: newContent } : log)); setEditingLogId(null); };
  const handleDeleteLog = (logId: string) => setLogToDelete(logId);
  const confirmDeleteLog = () => { if (logToDelete) { setLogs(prev => prev.filter(log => log.id !== logToDelete)); showNotification("SYSTEM", "Log deletion confirmed."); } setLogToDelete(null); };
  const cancelDeleteLog = () => setLogToDelete(null);

  const handleJournalSubmit = async (text: string) => {
    setIsProcessing(true);
    const tempId = Date.now().toString(), newLog: JournalLog = { id: tempId, timestamp: Date.now(), content: text, aiReply: 'Analyzing... [UPLINK_ESTABLISHED]', coinsEarned: 0, moodTag: 'PENDING' };
    setLogs(prev => [newLog, ...prev]);
    try {
      const result = await GeminiService.analyzeJournalEntry(text, persona, aiConfig, prompts);
      const journalHaptics = extractHapticMarkers(result.reply);
      const cleanReply = journalHaptics.cleanText;
      flushSync(() => {
          setLogs(prev => prev.map(log => log.id === tempId ? { ...log, aiReply: cleanReply, coinsEarned: result.coins, moodTag: result.mood_tag } : log));
      });
      scheduleParsedHaptics(journalHaptics, 'journal');
      setStats(prev => ({ ...prev, coins: prev.coins + isValidNumber(result.coins), energy: Math.max(0, prev.energy - 5), san: Math.min(100, Math.max(0, prev.san + isValidNumber(result.san_change))) }));
      if (result.coins > 0) showNotification("ASSET RECEIVED", `获得 ${result.coins} 信用点。`, { hapticEmotion: 'success' });
    } catch (error: any) { setLogs(prev => prev.filter(log => log.id !== tempId)); showNotification("UPLOAD FAILED", `连接中断，操作已回滚。\nReason: ${error.message || String(error)}`); } 
    finally { setIsProcessing(false); }
  };

  const handleRegenerateJournalReply = async (logId: string) => {
    const logToRegen = logs.find(log => log.id === logId);
    if (!logToRegen) return;

    const originalReply = logToRegen.aiReply;
    const originalCoins = logToRegen.coinsEarned;
    
    setLogs(prev => prev.map(log => log.id === logId ? { ...log, aiReply: 'Regenerating...' } : log));
    
    try {
        const result = await GeminiService.analyzeJournalEntry(logToRegen.content, persona, aiConfig, prompts);
        const regenHaptics = extractHapticMarkers(result.reply);
        const cleanReply = regenHaptics.cleanText;
        flushSync(() => {
            setLogs(prev => prev.map(log => log.id === logId ? {
                ...log,
                aiReply: cleanReply,
              coinsEarned: result.coins,
                moodTag: result.mood_tag
            } : log));
        });
        scheduleParsedHaptics(regenHaptics, 'journal_regen');

        setStats(prev => ({
            ...prev,
            coins: prev.coins - originalCoins + result.coins,
        }));
        
        const coinDiff = result.coins - originalCoins;
        showNotification("REGENERATION COMPLETE", `AI 回复已更新。信用点变化: ${coinDiff >= 0 ? '+' : ''}${coinDiff}`);
    } catch (error: any) {
        setLogs(prev => prev.map(log => log.id === logId ? { ...log, aiReply: originalReply } : log));
        showNotification("REGEN_FAILED", `回复生成失败: ${error.message}`);
    }
  };

  const [chatThinkingSessionId, setChatThinkingSessionId] = useState<string | null>(null);

    const handleStopStreamingOutput = (sessionId: string) => {
        if (activeStreamingTurnRef.current?.sessionId !== sessionId) return;
        activeStreamingTurnRef.current.cancelled = true;
        GeminiService.cancelActiveStreamingRequest();
    };

  // Initialize Overseer Session
  useEffect(() => {
    setChatSessions(prev => {
        const existingSession = prev.find(s => s.id === OVERSEER_SESSION_ID);

        if (!existingSession) {
            const overseerSession: ChatSession = {
                id: OVERSEER_SESSION_ID,
                name: DEFAULT_OVERSEER_NAME,
                messages: [],
                lastModified: Date.now()
            };
            return [overseerSession, ...prev];
        }

        if (existingSession.name === LEGACY_OVERSEER_NAME) {
            return prev.map(session => (
                session.id === OVERSEER_SESSION_ID
                    ? { ...session, name: DEFAULT_OVERSEER_NAME }
                    : session
            ));
        }

        return prev;
    });
  }, [chatSessions]);

  // ... existing refs ...

  // ... existing useEffects ...

  // 工具调用执行器 (供聊天消息处理器复用)
  const executeToolCall = (functionCall: { name: string; args: any }, toolAccess: GeminiService.ToolAccessMode): string => {
      if (!GeminiService.isToolAllowedForAccess(functionCall.name, toolAccess)) {
          return "Error: Tool not allowed in this session.";
      }
      if (functionCall.name === 'get_daily_bio_report' || functionCall.name === 'get_menstrual_cycle_report') {
          const isDailyReport = functionCall.name === 'get_daily_bio_report';
          const reportData = isDailyReport ? todayBioLogs : cycleDayLogs;
          if (reportData.length > 0) {
              const retrievalTs = new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              return isDailyReport
                  ? `[数据获取时间: ${retrievalTs}]\n今日生物日志:\n` + todayBioLogs.map(log => `[${new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute:'2-digit' })}] ${log.type}: ${log.description || 'Logged'}`).join('\n')
                  : `[数据获取时间: ${retrievalTs}]\n近期周期数据:\n` + [...cycleDayLogs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 30).map(log => {
                      let parts = [`Date: ${log.date}`, `Flow: ${log.flow}`];
                      if (log.pain.length > 0) parts.push(`Pain: ${log.pain.join(', ')}`);
                      if (log.mood.length > 0) parts.push(`Mood: ${log.mood.join(', ')}`);
                      if (log.notes) parts.push(`Notes: ${log.notes}`);
                      return `- ${parts.join('; ')}`;
                  }).join('\n');
          }
          return isDailyReport
              ? "[SYSTEM_TOOL_RESPONSE]: The tool returned no results for today's bio-data."
              : "[SYSTEM_TOOL_RESPONSE]: The tool returned no results for menstrual cycle data.";
      } else if (functionCall.name === 'check_vital_stats') {
          const latestStats = statsRef.current;
          const tsLabel = new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return `[VITAL_STATS_REPORT — 数据获取时间: ${tsLabel}，此数值是实时快照，之后可能已变化]\nSanity: ${latestStats.san}%\nEnergy: ${latestStats.energy}%\nCredits: ${latestStats.coins} CR\nUnlocked Turns: ${latestStats.unlockedChatTurns}`;
      } else if (functionCall.name === 'check_inventory') {
          const tsLabel = new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return gachaItems.length > 0 ? `[数据获取时间: ${tsLabel}]\n已获得物品:\n` + gachaItems.map(item => `- ${item.name}`).join('\n') : `[数据获取时间: ${tsLabel}]\n库存为空。`;
      } else if (functionCall.name === 'read_recent_journals') {
          const count = functionCall.args?.count || 5;
          const recentJournals = logs.slice(0, count);
          const retrievalTs = new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return recentJournals.length > 0 ? `[数据获取时间: ${retrievalTs}]\n近期日志记录:\n` + recentJournals.map(l => `[${new Date(l.timestamp).toLocaleDateString()}] ${l.content} (AI: ${l.aiReply})`).join('\n') : `[数据获取时间: ${retrievalTs}]\n无近期日志。`;
      } else if (functionCall.name === 'list_subroutine_archives') {
          return chatSessions.map(s => `- ID: ${s.id}, Name: ${s.name}, Messages: ${s.messages.length}, Last Active: ${new Date(s.lastModified).toLocaleString()}`).join('\n');
      } else if (functionCall.name === 'read_archive_content') {
          const targetSessionId = functionCall.args?.sessionId;
          let targetSession = chatSessions.find(s => String(s.id) === String(targetSessionId));
          if (!targetSession) targetSession = chatSessions.find(s => String(s.name) === String(targetSessionId));
          if (targetSession) {
              const limit = persona.archiveRecallLimit ?? 50;
              const messagesToRead = limit === 0 ? targetSession.messages : targetSession.messages.slice(-limit);
              const content = messagesToRead.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n');
              return `[ARCHIVE_CONTENT: ${targetSession.name}${limit === 0 ? ' (Full)' : ` (Last ${limit} msgs)`}]\n${content}`;
          }
          return "Error: Session ID not found.";
      } else if (functionCall.name === 'get_current_time') {
          // 返回设备真实时间，含星期和节日信息
          const now = new Date();
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
          const dateLabel = new Intl.DateTimeFormat('zh-CN', {
              year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
              timeZone: timezone
          }).format(now);
          const timeLabel = new Intl.DateTimeFormat('zh-CN', {
              hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
              timeZone: timezone
          }).format(now);
          const month = now.getMonth() + 1;
          const day = now.getDate();

          // 简单中国节日/节气检测
          const holidays: string[] = [];
          if (month === 1 && day === 1) holidays.push('元旦');
          if (month === 5 && day === 1) holidays.push('劳动节');
          if (month === 10 && day >= 1 && day <= 7) holidays.push('国庆节');
          if (month === 6 && day === 1) holidays.push('儿童节');
          if (month === 4 && day === 1) holidays.push('愚人节');
          if (month === 2 && day === 14) holidays.push('情人节');
          if (month === 3 && day === 8) holidays.push('妇女节');
          if (month === 12 && day === 25) holidays.push('圣诞节');

          // 春节粗略检测 (2026-2028)
          const lnyMap: Record<string, string> = {
              '2026-2-17': '春节(正月初一)', '2026-2-16': '除夕',
              '2027-2-6': '春节(正月初一)', '2027-2-5': '除夕',
              '2028-1-26': '春节(正月初一)', '2028-1-25': '除夕',
          };
          const todayKey = `${now.getFullYear()}-${month}-${day}`;
          if (lnyMap[todayKey]) holidays.push(lnyMap[todayKey]);

          const holidayInfo = holidays.length > 0 ? `\n- 今日节日/节气: ${holidays.join('、')}` : '';
          const weekOfYear = Math.ceil((((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) + 1) / 7);

          return `[设备时间]
- 当前时间: ${dateLabel} ${timeLabel}
- 时区: ${timezone}
- 星期: ${new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now)}
- 年份第${weekOfYear}周
- Unix 时间戳: ${now.getTime()}${holidayInfo}`;
      } else if (functionCall.name === 'trigger_haptic_feedback') {
          return `Haptic feedback noted.`;
      }
      return "Error: Unknown function called";
  };

  const resolveToolAccessMode = (sessionId: string): GeminiService.ToolAccessMode => (
      sessionId === OVERSEER_SESSION_ID ? 'overseer' : 'standard'
  );

  type AssistantToolCall = GeminiService.ToolCallEnvelope;
  type AssistantTurnOptions = {
      sessionId: string;
      history: ChatMessage[];
      userMsgId?: string;
      effectiveAiConfig: AIConfig;
      shouldStream: boolean;
      toolAccess: GeminiService.ToolAccessMode;
      systemOverride?: string;
      toolStatusVerb: 'EXECUTING' | 'RE-EXECUTING';
      buildEmptyMessage: (iterations: number, maxIterations: number) => string;
  };

  const updateSessionMessages = (
      sessionId: string,
      updater: (messages: ChatMessage[]) => ChatMessage[],
      options: { flush?: boolean; touchLastModified?: boolean } = {}
  ) => {
      const applyUpdate = () => {
          setChatSessions(prev => {
              const idx = prev.findIndex(s => s.id === sessionId);
              if (idx === -1) return prev;

              const newSessions = [...prev];
              const currentSession = newSessions[idx];
              newSessions[idx] = {
                  ...currentSession,
                  messages: updater(currentSession.messages),
                  lastModified: options.touchLastModified ? Date.now() : currentSession.lastModified
              };
              return newSessions;
          });
      };

      if (options.flush) {
          flushSync(applyUpdate);
      } else {
          applyUpdate();
      }
  };

  const markUserMessageSuccess = (messages: ChatMessage[], userMsgId?: string) => {
      if (!userMsgId) return messages;
      return messages.map(m => m.id === userMsgId ? { ...m, status: 'SUCCESS' as const, error: undefined } : m);
  };

  const buildToolStatusText = (toolCalls: AssistantToolCall[], verb: 'EXECUTING' | 'RE-EXECUTING') =>
      `[SYSTEM: ${verb} ${toolCalls.length} SUBROUTINES: ${toolCalls.map(f => f.name.toUpperCase()).join(', ')}...]`;

  const createAssistantTurnSnapshot = (config: AIConfig) => {
      const effectiveAiConfig = normalizeAiConfig(config);
      return {
          effectiveAiConfig,
          shouldStream: effectiveAiConfig.enableStreaming === true
      };
  };

  type HiddenToolPrefetchResult = {
      history: any[];
      fallbackWithoutTools: boolean;
  };

  const HIDDEN_PREFETCH_CANCELLED = '__HIDDEN_PREFETCH_CANCELLED__';

  const runHiddenToolPrefetch = async (
      options: AssistantTurnOptions,
      initialHistory: any[],
      onToolCalls?: (toolCalls: AssistantToolCall[]) => void,
      isCancelled?: () => boolean
  ): Promise<HiddenToolPrefetchResult> => {
      const effectiveAiConfig = options.effectiveAiConfig;
      let currentHistory: any[] = [...initialHistory];
      let retryCount = 0;
      let iterations = 0;
      let sawStructuredTool = false;

      appendDiagnosticsLog({
          domain: 'stream',
          source: 'chat',
          status: 'success',
          message: 'Started hidden tool prefetch.',
          details: `reason=hidden_tool_prefetch_started session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} toolAccess=${options.toolAccess} enableStreaming=${effectiveAiConfig.enableStreaming ? 'true' : 'false'}`,
      });

      while (iterations < 5) {
          if (isCancelled?.()) {
              throw new Error(HIDDEN_PREFETCH_CANCELLED);
          }

          let response: any;
          try {
              response = await GeminiService.generateChatResponseWithTools(
                  persona,
                  effectiveAiConfig,
                  prompts,
                  logs,
                  memoryBank,
                  todayBioLogs,
                  currentHistory as ChatMessage[],
                  undefined,
                  undefined,
                  options.systemOverride,
                  options.toolAccess,
                  GeminiService.buildHiddenToolPrefetchInstruction(effectiveAiConfig, retryCount)
              );
          } catch (error: any) {
              if (retryCount === 0) {
                  retryCount = 1;
                  appendDiagnosticsLog({
                      domain: 'stream',
                      source: 'chat',
                      status: 'fallback',
                      message: 'Retrying hidden tool prefetch after an initial failure.',
                      details: `reason=hidden_tool_prefetch_retried session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} error=${error?.message || 'unknown error'}`,
                  });
                  continue;
              }

              appendDiagnosticsLog({
                  domain: 'stream',
                  source: 'chat',
                  status: 'error',
                  message: 'Hidden tool prefetch failed.',
                  details: `reason=hidden_tool_prefetch_failed session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} sawStructuredTool=${sawStructuredTool ? 'yes' : 'no'} error=${error?.message || 'unknown error'}`,
              });

              if (!sawStructuredTool) {
                  throw error;
              }

              return {
                  history: currentHistory,
                  fallbackWithoutTools: false
              };
          }

          const functionCalls = (response.functionCalls || []) as AssistantToolCall[];
          if (functionCalls.length > 0) {
              sawStructuredTool = true;
              retryCount = 0;
              iterations += 1;
              onToolCalls?.(functionCalls);

              const toolResponses = await Promise.all(functionCalls.map(async functionCall => {
                  const reportString = executeToolCall(functionCall, options.toolAccess);
                  return GeminiService.createToolResultPart(
                      functionCall.name,
                      { report: reportString },
                      functionCall.id || functionCall._id
                  );
              }));

              const modelTurn = response.candidates?.[0]?.content;
              const historySafeModelTurn = GeminiService.buildHistorySafeModelTurn(
                  effectiveAiConfig,
                  modelTurn as any
              );
              if (historySafeModelTurn && historySafeModelTurn.parts.length > 0) {
                  currentHistory.push(historySafeModelTurn);
              }
              currentHistory.push({ role: 'tool', parts: toolResponses });

              appendDiagnosticsLog({
                  domain: 'stream',
                  source: 'chat',
                  status: 'success',
                  message: 'Hidden tool prefetch received structured tool calls.',
                  details: `reason=hidden_tool_prefetch_tool_calls_received session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} toolCount=${functionCalls.length}`,
              });
              continue;
          }

          const hiddenText = GeminiService.extractText(response).trim();
          if (GeminiService.isNoToolSentinel(hiddenText)) {
              appendDiagnosticsLog({
                  domain: 'stream',
                  source: 'chat',
                  status: 'success',
                  message: 'Hidden tool prefetch determined that no tools are needed.',
                  details: `reason=hidden_tool_prefetch_no_tool session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId}`,
              });
              return {
                  history: currentHistory,
                  fallbackWithoutTools: false
              };
          }

          if (retryCount === 0) {
              retryCount = 1;
              appendDiagnosticsLog({
                  domain: 'stream',
                  source: 'chat',
                  status: 'fallback',
                  message: 'Retrying hidden tool prefetch because it returned text instead of a structured tool call.',
                  details: `reason=hidden_tool_prefetch_retried session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} hiddenText=${hiddenText.slice(0, 120)}`,
              });
              continue;
          }

          appendDiagnosticsLog({
              domain: 'stream',
              source: 'chat',
              status: 'fallback',
              message: 'Hidden tool prefetch fell back to a visible reply without tools.',
              details: `reason=visible_reply_fallback_without_tools session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} hiddenText=${hiddenText.slice(0, 120)}`,
          });
          return {
              history: currentHistory,
              fallbackWithoutTools: !sawStructuredTool
          };
      }

      return {
          history: currentHistory,
          fallbackWithoutTools: !sawStructuredTool
      };
  };

  const runNonStreamingAssistantTurn = async (options: AssistantTurnOptions) => {
      const effectiveAiConfig = options.effectiveAiConfig;
      let currentHistory: any[] = [...options.history];
      let placeholderId: string | null = null;
      let lastResponse: any = null;
      let clearedStaleStreamingUi = false;

      updateSessionMessages(options.sessionId, messages => messages.filter(message => {
          const keepMessage = message.transientType !== 'streaming';
          if (!keepMessage) {
              clearedStaleStreamingUi = true;
          }
          return keepMessage;
      }), { flush: true });

      const upsertToolStatusMessage = (toolCalls: AssistantToolCall[]) => {
          const statusText = buildToolStatusText(toolCalls, options.toolStatusVerb);
          if (!placeholderId) {
              placeholderId = `tool_call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const nextPlaceholderId = placeholderId;
              updateSessionMessages(options.sessionId, messages => [
                  ...markUserMessageSuccess(messages, options.userMsgId),
                  {
                      id: nextPlaceholderId,
                      role: 'model',
                      text: statusText,
                      timestamp: Date.now(),
                      transientType: 'tool_status'
                  }
              ]);
              return;
          }

          const currentPlaceholderId = placeholderId;
          updateSessionMessages(options.sessionId, messages =>
              markUserMessageSuccess(messages, options.userMsgId).map(m =>
                  m.id === currentPlaceholderId ? { ...m, text: statusText } : m
              )
          );
      };

      try {
          let fallbackWithoutTools = false;

          // Pre-execute essential tools for overseer mode BEFORE the hidden prefetch.
          // Injected as plain-text context to avoid breaking DeepSeek thinking mode.
          if (options.toolAccess === 'overseer') {
              const overseerPreCalls: Array<{ name: string; args: Record<string, unknown> }> = [
                  { name: 'get_current_time', args: {} },
                  { name: 'check_vital_stats', args: {} },
              ];

              upsertToolStatusMessage(overseerPreCalls);

              const preFetchReports: string[] = [];
              for (const functionCall of overseerPreCalls) {
                  const reportString = executeToolCall(functionCall, options.toolAccess);
                  preFetchReports.push(reportString);
              }

              currentHistory.push({
                  role: 'user',
                  parts: [{
                      text: `[系统数据预取 — 在本次回复前自动获取的实时数据，绝对可靠]\n\n${preFetchReports.join('\n\n')}`,
                  }],
              });
          }

          if (options.toolAccess !== 'none') {
              const prefetchResult = await runHiddenToolPrefetch(options, currentHistory, upsertToolStatusMessage);
              currentHistory = prefetchResult.history;
              fallbackWithoutTools = prefetchResult.fallbackWithoutTools;
          }

          const response = await GeminiService.generateChatResponseWithTools(
              persona,
              effectiveAiConfig,
              prompts,
              logs,
              memoryBank,
              todayBioLogs,
              currentHistory as ChatMessage[],
              undefined,
              undefined,
              options.systemOverride,
              'none',
              options.toolAccess !== 'none'
                  ? GeminiService.buildVisibleReplyInstruction(effectiveAiConfig, fallbackWithoutTools)
                  : undefined
          );
          lastResponse = response;

          if ((response.functionCalls || []).length > 0) {
              appendDiagnosticsLog({
                  domain: 'stream',
                  source: 'chat',
                  status: 'fallback',
                  message: 'Visible reply unexpectedly attempted another tool call after hidden prefetch.',
                  details: `session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} functionCalls=${response.functionCalls.length}`,
              });
          }

          let finalAiText = GeminiService.extractText(response);
          if (!finalAiText.trim()) {
              finalAiText = options.buildEmptyMessage(1, 1);
          }

          const finalAiHaptics = extractHapticMarkers(finalAiText);
          const cleanFinalAiText = finalAiHaptics.cleanText;
          const finalAiMsg: ChatMessage = {
              id: Date.now().toString() + '_ai_final',
              role: 'model',
              text: cleanFinalAiText,
              reasoning: lastResponse?.candidates?.[0]?.content?.parts?.find((p: any) => (p as any)._reasoningContent)?._reasoningContent,
              timestamp: Date.now()
          };

          updateSessionMessages(options.sessionId, messages => {
              let updatedMessages = markUserMessageSuccess(messages, options.userMsgId);
              if (placeholderId && updatedMessages.some(m => m.id === placeholderId)) {
                  updatedMessages = updatedMessages.map(m => m.id === placeholderId ? finalAiMsg : m);
              } else {
                  updatedMessages = [...updatedMessages, finalAiMsg];
              }
              return updatedMessages.filter(m => m.transientType !== 'tool_status' && m.transientType !== 'streaming');
          }, { flush: true, touchLastModified: true });

          appendDiagnosticsLog({
              domain: 'stream',
              source: 'chat',
              status: 'success',
              message: 'Visible reply committed without streaming.',
              details: `session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} enableStreaming=${effectiveAiConfig.enableStreaming ? 'true' : 'false'} chosenPath=non-stream hadStreamingMessage=no clearedStaleStreamingUi=${clearedStaleStreamingUi ? 'yes' : 'no'}`,
          });

          scheduleParsedHaptics(finalAiHaptics, 'chat');
      } catch (error: any) {
          if (error?.message === HIDDEN_PREFETCH_CANCELLED) {
              return;
          }
          updateSessionMessages(
              options.sessionId,
              messages => messages.filter(m => m.id !== placeholderId && m.transientType !== 'tool_status' && m.transientType !== 'streaming'),
              { flush: true }
          );
          throw error;
      }
  };

  const runStreamingAssistantTurn = async (options: AssistantTurnOptions) => {
        const effectiveAiConfig = options.effectiveAiConfig;
        const turnControl = { sessionId: options.sessionId, cancelled: false };
        activeStreamingTurnRef.current = turnControl;
        setActiveStreamingSessionId(options.sessionId);
        let currentHistory: any[] = [...options.history];
        let streamingMsgId: string | null = null;
        const toolStatusMsgId = `tool_status_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      let toolStatusVisible = false;
        let lastUpdateTime = 0;
        const UPDATE_INTERVAL = 32;
        const hapticDetector = new StreamHapticDetector('chat');
        const isCancelled = () => turnControl.cancelled;
        let accReasoning = '';  // 累积 DeepSeek V4 Pro 的 thinking 内容

        const upsertToolStatusMessage = (toolCalls: AssistantToolCall[]) => {
          const hadToolStatus = toolStatusVisible;
          toolStatusVisible = true;
          const statusText = buildToolStatusText(toolCalls, options.toolStatusVerb);
          updateSessionMessages(options.sessionId, messages => {
              const updatedMessages = markUserMessageSuccess(messages, options.userMsgId);
              if (updatedMessages.some(m => m.id === toolStatusMsgId)) {
                  return updatedMessages.map(m => m.id === toolStatusMsgId ? { ...m, text: statusText } : m);
              }
              return [
                  ...updatedMessages,
                  {
                      id: toolStatusMsgId,
                      role: 'model',
                      text: statusText,
                      timestamp: Date.now(),
                      transientType: 'tool_status'
                  }
              ];
          }, { flush: !hadToolStatus });
      };

        const updateStreamingMessage = (displayText: string, optionsForUpdate: { isFinal?: boolean; hideToolStatus?: boolean } = {}) => {
            if (!displayText && !streamingMsgId) return;

          const shouldHideToolStatus = !!optionsForUpdate.hideToolStatus && toolStatusVisible;
          const now = Date.now();
          const forceUpdate = !!optionsForUpdate.isFinal || !streamingMsgId || shouldHideToolStatus;
          if (!forceUpdate && now - lastUpdateTime < UPDATE_INTERVAL) return;
          lastUpdateTime = now;

          const hadStreamingMessage = !!streamingMsgId;
          if (!streamingMsgId) {
              streamingMsgId = `streaming_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          }

          const currentStreamingMsgId = streamingMsgId;
          if (shouldHideToolStatus) {
              toolStatusVisible = false;
          }

          updateSessionMessages(options.sessionId, messages => {
              let updatedMessages = markUserMessageSuccess(messages, options.userMsgId);
              if (shouldHideToolStatus) {
                  updatedMessages = updatedMessages.filter(m => m.id !== toolStatusMsgId);
              }

              if (updatedMessages.some(m => m.id === currentStreamingMsgId)) {
                  return updatedMessages.map(m =>
                      m.id === currentStreamingMsgId
                          ? { ...m, text: displayText, transientType: 'streaming' }
                          : m
                  );
              }

              return [
                  ...updatedMessages,
                  {
                      id: currentStreamingMsgId,
                      role: 'model',
                      text: displayText,
                      timestamp: Date.now(),
                      transientType: 'streaming'
                  }
              ];
            }, { flush: !hadStreamingMessage || !!optionsForUpdate.isFinal });
        };

        const finalizeCancelledStreamingTurn = () => {
            const partialCleanText = hapticDetector.flush().trim();

            appendDiagnosticsLog({
                domain: 'stream',
                source: 'chat',
                status: 'skipped',
                message: partialCleanText
                    ? 'Streaming output stopped by user. Partial response was preserved.'
                    : 'Streaming output stopped by user before any response text arrived.',
                details: `session=${options.sessionId}`,
            });

            updateSessionMessages(options.sessionId, messages => {
                let updatedMessages = markUserMessageSuccess(messages, options.userMsgId)
                    .filter(m => m.id !== toolStatusMsgId);

                if (streamingMsgId) {
                    if (partialCleanText) {
                        const finalPartialMessage: ChatMessage = {
                            id: streamingMsgId,
                            role: 'model',
                            text: partialCleanText,
                            timestamp: Date.now(),
                        };
                        if (updatedMessages.some(m => m.id === streamingMsgId)) {
                            updatedMessages = updatedMessages.map(m => m.id === streamingMsgId ? finalPartialMessage : m);
                        } else {
                            updatedMessages = [...updatedMessages, finalPartialMessage];
                        }
                    } else {
                        updatedMessages = updatedMessages.filter(m => m.id !== streamingMsgId);
                    }
                }

                return updatedMessages.filter(m => m.transientType !== 'tool_status');
            }, { flush: true, touchLastModified: true });
        };

        try {
            let fallbackWithoutTools = false;
            const isDeepSeek = effectiveAiConfig.provider === 'deepseek';

            // Pre-execute essential tools for overseer mode BEFORE the hidden prefetch.
            // Results are injected as plain-text context (NOT fake model/tool turns)
            // to avoid breaking DeepSeek thinking mode (which requires reasoning_content
            // on every assistant message).
            if (options.toolAccess === 'overseer') {
                const overseerPreCalls: Array<{ name: string; args: Record<string, unknown> }> = [
                    { name: 'get_current_time', args: {} },
                    { name: 'check_vital_stats', args: {} },
                ];

                upsertToolStatusMessage(overseerPreCalls);

                const preFetchReports: string[] = [];
                for (const functionCall of overseerPreCalls) {
                    const reportString = executeToolCall(functionCall, options.toolAccess);
                    preFetchReports.push(reportString);
                }

                // Inject as a user-role context message — no fake model turn,
                // so DeepSeek thinking mode won't complain about missing reasoning_content.
                currentHistory.push({
                    role: 'user',
                    parts: [{
                        text: `[系统数据预取 — 在本次回复前自动获取的实时数据，绝对可靠]\n\n${preFetchReports.join('\n\n')}`,
                    }],
                });
            }

            if (options.toolAccess !== 'none') {
                // All providers: use hidden tool prefetch via non-streaming API
                // This avoids native stream issues with tool calls on Android
                const prefetchResult = await runHiddenToolPrefetch(options, currentHistory, upsertToolStatusMessage, isCancelled);
                currentHistory = prefetchResult.history;
                fallbackWithoutTools = prefetchResult.fallbackWithoutTools;
            }

            // Never expose tools during visible streaming — tool results are already in history
            const visibleToolAccess = 'none' as GeminiService.ToolAccessMode;
            const visibleAdditionalInstruction = (options.toolAccess !== 'none')
                ? GeminiService.buildVisibleReplyInstruction(effectiveAiConfig, fallbackWithoutTools)
                : undefined;

            let streamGenerator = GeminiService.generateChatResponseStream(
                persona,
                effectiveAiConfig,
                prompts,
                logs,
                memoryBank,
                todayBioLogs,
                currentHistory as ChatMessage[],
                options.systemOverride,
                visibleToolAccess,
                visibleAdditionalInstruction
            );

            // For DeepSeek: loop to handle tool calls mid-stream
            let deepSeekToolLoop = isDeepSeek;
            while (true) {
                const receivedToolCalls: StreamChunk['toolCall'][] = [];
                let hadText = false;

                for await (const chunk of streamGenerator) {
                    if (isCancelled()) break;

                    if (chunk.type === 'thinking' && chunk.thinkingText) {
                        accReasoning += chunk.thinkingText;
                    } else if (chunk.type === 'text' && chunk.text) {
                        hadText = true;
                        const displayText = hapticDetector.processChunk(chunk.text);
                        updateStreamingMessage(displayText, { hideToolStatus: toolStatusVisible });
                    } else if (chunk.type === 'error') {
                        throw new Error(chunk.error || 'Stream error');
                    } else if (chunk.type === 'tool_call' && chunk.toolCall) {
                        receivedToolCalls.push(chunk.toolCall);
                    }
                }

                // DeepSeek: if tool calls were received, execute them and restart stream
                if (deepSeekToolLoop && receivedToolCalls.length > 0 && !isCancelled()) {
                    upsertToolStatusMessage(receivedToolCalls as any[]);
                    const modelTurnResponse = { candidates: [{ content: { role: 'model', parts: [] } }] };
                    // Build model turn from received tool calls
                    const historySafeModelTurn = GeminiService.buildHistorySafeModelTurn(
                        effectiveAiConfig,
                        { role: 'model', parts: receivedToolCalls.map(tc => ({ functionCall: { name: tc.name, args: tc.args, ...(tc.id ? { id: tc.id } : {}) } })) } as any
                    );
                    if (historySafeModelTurn && historySafeModelTurn.parts.length > 0) {
                        currentHistory.push(historySafeModelTurn);
                    }

                    const toolResponses = await Promise.all(receivedToolCalls.map(async tc => {
                        const functionCall = { name: tc.name || '', args: tc.args || {} };
                        const reportString = executeToolCall(functionCall, options.toolAccess);
                        return GeminiService.createToolResultPart(
                            functionCall.name,
                            { report: reportString },
                            tc.id || tc._id
                        );
                    }));
                    currentHistory.push({ role: 'tool', parts: toolResponses });

                    // Restart stream with updated history
                    streamGenerator = GeminiService.generateChatResponseStream(
                        persona, effectiveAiConfig, prompts, logs, memoryBank, todayBioLogs,
                        currentHistory as ChatMessage[], options.systemOverride,
                        visibleToolAccess, undefined
                    );
                    continue; // continue the outer while loop
                }

                break; // no tool calls or not DeepSeek — exit loop
            }

            if (isCancelled()) {
                finalizeCancelledStreamingTurn();
                return;
            }

            let finalCleanText = hapticDetector.flush();
            if (!finalCleanText.trim()) {
                finalCleanText = options.buildEmptyMessage(1, 1);
            }

            const finalAiHaptics = extractHapticMarkers(finalCleanText);
            const cleanFinalAiText = finalAiHaptics.cleanText;

            if (!hapticDetector.getTriggeredEmotion() && !finalAiHaptics.cues.length) {
                recordSkippedHaptic('chat', finalAiHaptics.skipReason || 'missing_marker');
            } else if (!hapticDetector.getTriggeredEmotion()) {
                scheduleParsedHaptics(finalAiHaptics, 'chat', 'immediate');
            }

            const finalAiMsg: ChatMessage = {
                id: Date.now().toString() + '_ai_stream_final',
                role: 'model',
                text: cleanFinalAiText,
                reasoning: accReasoning || undefined,
                timestamp: Date.now()
            };

            updateSessionMessages(options.sessionId, messages => {
                let updatedMessages = markUserMessageSuccess(messages, options.userMsgId)
                    .filter(m => m.id !== toolStatusMsgId);

                if (streamingMsgId && updatedMessages.some(m => m.id === streamingMsgId)) {
                    updatedMessages = updatedMessages.map(m => m.id === streamingMsgId ? finalAiMsg : m);
                } else {
                    updatedMessages = [...updatedMessages, finalAiMsg];
                }

                return updatedMessages.filter(m => m.transientType !== 'tool_status');
            }, { flush: true, touchLastModified: true });

            appendDiagnosticsLog({
                domain: 'stream',
                source: 'chat',
                status: 'success',
                message: 'Visible reply committed via streaming.',
                details: `session=${options.sessionId} provider=${effectiveAiConfig.provider} model=${effectiveAiConfig.modelId} enableStreaming=${effectiveAiConfig.enableStreaming ? 'true' : 'false'} chosenPath=stream hadStreamingMessage=${streamingMsgId ? 'yes' : 'no'}`,
            });
        } catch (error: any) {
            if (error?.message === HIDDEN_PREFETCH_CANCELLED) {
                finalizeCancelledStreamingTurn();
                return;
            }
            const partialCleanText = hapticDetector.flush().trim();
            if (partialCleanText) {
                const partialAiMsg: ChatMessage = {
                    id: Date.now().toString() + '_ai_stream_partial',
                    role: 'model',
                    text: partialCleanText,
                    timestamp: Date.now()
                };

                updateSessionMessages(options.sessionId, messages => {
                    let updatedMessages = markUserMessageSuccess(messages, options.userMsgId)
                        .filter(m => m.id !== toolStatusMsgId);

                    if (streamingMsgId && updatedMessages.some(m => m.id === streamingMsgId)) {
                        updatedMessages = updatedMessages.map(m => m.id === streamingMsgId ? partialAiMsg : m);
                    } else {
                        updatedMessages = [...updatedMessages, partialAiMsg];
                    }

                    return updatedMessages.filter(m => m.transientType !== 'tool_status');
                }, { flush: true, touchLastModified: true });
            } else {
                updateSessionMessages(options.sessionId, messages =>
                    messages.filter(m => m.id !== toolStatusMsgId && m.id !== streamingMsgId && m.transientType !== 'tool_status'),
                    { flush: true }
                );
            }
            throw error;
        } finally {
            if (activeStreamingTurnRef.current === turnControl) {
                activeStreamingTurnRef.current = null;
            }
            setActiveStreamingSessionId(prev => prev === options.sessionId ? null : prev);
        }
    };

  const runAssistantTurn = async (options: AssistantTurnOptions) => {
      appendDiagnosticsLog({
          domain: 'stream',
          source: 'chat',
          status: 'success',
          message: 'Assistant turn path selected.',
          details: `session=${options.sessionId} provider=${options.effectiveAiConfig.provider} model=${options.effectiveAiConfig.modelId} enableStreaming=${options.effectiveAiConfig.enableStreaming ? 'true' : 'false'} chosenPath=${options.shouldStream ? 'stream' : 'non-stream'}`,
      });

      if (options.shouldStream) {
          await runStreamingAssistantTurn(options);
          return;
      }

      if (activeStreamingTurnRef.current?.sessionId === options.sessionId) {
          activeStreamingTurnRef.current.cancelled = true;
          activeStreamingTurnRef.current = null;
      }
      setActiveStreamingSessionId(prev => prev === options.sessionId ? null : prev);
      await runNonStreamingAssistantTurn(options);
  };

  const handleChatSendMessage = async (sessionId: string, text: string) => {
      const currentSession = chatSessions.find(s => s.id === sessionId);
      if (!currentSession) throw new Error("Session not found");

      const userMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          text,
          timestamp: Date.now(),
          status: 'PENDING'
      };

      const stableMessages = currentSession.messages.filter(m => !m.transientType);

      updateSessionMessages(
          sessionId,
          messages => [...messages.filter(m => !m.transientType), userMsg],
          { touchLastModified: true }
      );

      setStats(prev => ({ ...prev, unlockedChatTurns: prev.unlockedChatTurns - 1 }));
      setChatThinkingSessionId(sessionId);

      try {
          const { effectiveAiConfig, shouldStream } = createAssistantTurnSnapshot(aiConfig);
          const history = [...stableMessages, userMsg];
          const isOverseer = sessionId === OVERSEER_SESSION_ID;
          const systemOverride = isOverseer ? GeminiService.fillTemplate(prompts.overseer || GeminiService.DEFAULT_PROMPTS.overseer, { name: persona.name }) : undefined;
          await runAssistantTurn({
              sessionId,
              history,
              userMsgId: userMsg.id,
              effectiveAiConfig,
              shouldStream,
              toolAccess: resolveToolAccessMode(sessionId),
              systemOverride,
              toolStatusVerb: 'EXECUTING',
              buildEmptyMessage: (iterations, maxIterations) => {
                  if (iterations >= maxIterations) {
                      return "【系统提示】达到最大递归深度。主脑似乎陷入了逻辑循环。";
                  }
                  setStats(prev => ({ ...prev, unlockedChatTurns: prev.unlockedChatTurns + 1 }));
                  return "【系统提示】数据已读取，但分析模块暂时无法生成文本。（已返还对话次数）";
              }
          });
      } catch (error: any) {
          const errorMessage = error?.message || 'Unknown error';
          console.error("Chat Error:", error);
          updateSessionMessages(sessionId, messages => messages
              .filter(m => !m.transientType)
              .map(m => m.id === userMsg.id ? { ...m, status: 'FAILED' as const, error: errorMessage } : m), { touchLastModified: true });
          setStats(prev => ({ ...prev, unlockedChatTurns: prev.unlockedChatTurns + 1 }));
      } finally {
          setChatThinkingSessionId(null);
      }
  };

  const handleRetryChatMessage = async (sessionId: string, messageId: string) => {
      const sessionIndex = chatSessions.findIndex(s => s.id === sessionId);
      if (sessionIndex === -1) return;

      const session = chatSessions[sessionIndex];
      const messageToRetry = session.messages.find(m => m.id === messageId);

      if (!messageToRetry || messageToRetry.status !== 'FAILED') return;

      // Remove failed message
      setChatSessions(prev => {
          const newSessions = [...prev];
          newSessions[sessionIndex] = { 
              ...newSessions[sessionIndex], 
              messages: newSessions[sessionIndex].messages.filter(m => m.id !== messageId) 
          };
          return newSessions;
      });

      // Resend
      await handleChatSendMessage(sessionId, messageToRetry.text);
  };

  const handleChatRegenerateMessage = async (sessionId: string) => {
      const session = chatSessions.find(s => s.id === sessionId);
      if (!session) return;

      const messages = session.messages.filter(m => !m.transientType);
      if (messages.length < 1) return;
      
      let lastUserMessageIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
              lastUserMessageIndex = i;
              break;
          }
      }
      if (lastUserMessageIndex === -1) return;

      const historyForRegen = messages.slice(0, lastUserMessageIndex + 1);
      const previousMessages = messages;

      updateSessionMessages(sessionId, () => historyForRegen, { flush: true, touchLastModified: true });

      setChatThinkingSessionId(sessionId);

      try {
          const { effectiveAiConfig, shouldStream } = createAssistantTurnSnapshot(aiConfig);
          const isOverseer = sessionId === OVERSEER_SESSION_ID;
          const systemOverride = isOverseer ? GeminiService.fillTemplate(prompts.overseer || GeminiService.DEFAULT_PROMPTS.overseer, { name: persona.name }) : undefined;
          await runAssistantTurn({
              sessionId,
              history: historyForRegen,
              effectiveAiConfig,
              shouldStream,
              toolAccess: resolveToolAccessMode(sessionId),
              systemOverride,
              toolStatusVerb: 'RE-EXECUTING',
              buildEmptyMessage: () => "【系统提示】重新生成完成，但分析模块暂时无法生成文本。"
          });
      } catch (error: any) {
          console.error("Regen Error:", error);
          updateSessionMessages(sessionId, () => previousMessages, { flush: true, touchLastModified: true });
          showNotification("REGEN_FAILED", error?.message || "重新生成失败，请检查网络连接。");
      } finally {
          setChatThinkingSessionId(null);
      }
  };

  const handleFocusFail = async () => { 
      const mockery = await GeminiService.generateFocusFailMockery(persona, aiConfig, prompts, "用户切后台/逃跑"); 
      setStats(prev => ({ ...prev, coins: Math.max(0, prev.coins - 20), san: Math.max(0, prev.san - 15), energy: Math.max(0, prev.energy - 5) })); 
      showNotification(`[${persona.name.split(' ')[0]}] ⚠️ 任务失败`, mockery); 
      switchMainView(AppView.DASHBOARD); 
  };
  
  const handleFocusSuccess = async (durationMinutes: number) => { 
      triggerHaptic('success', 'focus', 'focus_completion');

      // Reward Formula: 1 min = 2 coins, 1 min = 0.5 san (max 20), 1 min = -0.5 energy
      const coinsEarned = Math.floor(durationMinutes * 2);
      const sanEarned = Math.min(20, Math.floor(durationMinutes * 0.5));
      const energyCost = Math.floor(durationMinutes * 0.5);

      setStats(prev => ({ 
          ...prev, 
          coins: prev.coins + coinsEarned, 
          san: Math.min(100, prev.san + sanEarned), 
          energy: Math.max(0, prev.energy - energyCost) 
      })); 
      
      switchMainView(AppView.DASHBOARD); 
      
      try {
          const encouragement = await GeminiService.generateFocusSuccessEncouragement(persona, aiConfig, prompts, durationMinutes);
          const fullMessage = `${encouragement}\n\n[ 奖励发放: +${coinsEarned} CR ]`;
          showNotification("MISSION COMPLETE", fullMessage, { source: 'focus', suppressHaptics: true });
      } catch (e) {
          showNotification("MISSION COMPLETE", `专注完成 (${durationMinutes}m)。获得 ${coinsEarned} 信用点。`, {
              source: 'focus',
              hapticEmotion: 'success',
              suppressHaptics: true
          }); 
      }
  };
  
  const handleFocusAbort = async () => { 
      switchMainView(AppView.DASHBOARD);
      showNotification("MISSION ABORTED", "任务中止。正在结算..."); 

      const penalty = 50;
      setStats(prev => ({ ...prev, coins: Math.max(0, prev.coins - penalty) })); 
      
      try {
          const mockery = await GeminiService.generateFocusFailMockery(persona, aiConfig, prompts, "用户主动点击放弃按钮，中止了专注任务");
          const fullMessage = `${mockery}\n\n[ 惩罚执行: -${penalty} CR ]`;
          showNotification(`[${persona.name.split(' ')[0]}] ⚠️ 逃逸惩罚`, fullMessage);
      } catch (e) {
           showNotification("MISSION ABORTED", `任务中止。\n扣除 ${penalty} 信用点。`, { hapticEmotion: 'warning' }); 
      }
  };

  const handleLifeLogRecord = async (type: LifeEventType, content?: string) => {
    // 1. 处理需要 AI 分析的类型 (MEAL / WAKE_UP)
    if (type === 'MEAL' || type === 'WAKE_UP') {
        if (!content) return; // 必须有内容

        const tempId = Date.now().toString();
        // 初始状态：PENDING
        const tempLog: LifeLog = { 
            id: tempId, 
            timestamp: Date.now(), 
            type, 
            description: content, 
            status: 'PENDING',
            rawInput: content 
        };
        
        setLifeLogs(prev => [tempLog, ...prev]);
        setIsBioAnalyzing(true);

        try {
            if (type === 'MEAL') {
                const analysis = await GeminiService.analyzeFoodLog(content, persona, aiConfig, prompts);

                // 成功：更新日志状态，应用数值 + 触发震动
                const foodHaptics = extractHapticMarkers(analysis.analysis);
                const cleanFoodAnalysis = foodHaptics.cleanText;
                setLifeLogs(prev => prev.map(l => l.id === tempId ? {
                    ...l,
                    description: content,
                    status: 'SUCCESS',
                    aiAnalysis: cleanFoodAnalysis,
                    coinChange: analysis.coinChange
                } : l));
                scheduleParsedHaptics(foodHaptics, 'food');

                setFoodAnalysisResult({ ...analysis, analysis: cleanFoodAnalysis }); // 只有成功时才显示弹窗
                setStats(prev => ({
                    ...prev,
                    coins: Math.max(0, prev.coins + isValidNumber(analysis.coinChange)),
                    energy: Math.min(100, Math.max(0, prev.energy + isValidNumber(analysis.energyChange))),
                    san: Math.min(100, Math.max(0, prev.san + isValidNumber(analysis.sanChange)))
                }));

            } else if (type === 'WAKE_UP') {
                // 计算睡眠数据
                const lastSleep = lifeLogs.find(l => l.type === 'SLEEP');
                const sleepDurationHours = lastSleep ? (Date.now() - lastSleep.timestamp) / 3600000 : 0;
                
                // 收集昨日日志
                const lastWakeUp = [...lifeLogs].filter(l => l.type === 'WAKE_UP' && l.id !== tempId).sort((a,b)=>b.timestamp - a.timestamp)[0];
                const startOfPeriod = lastWakeUp ? lastWakeUp.timestamp : Date.now() - 24 * 3600000;
                const yesterdayLogs = lifeLogs.filter(l => l.timestamp >= startOfPeriod && l.timestamp < Date.now() && ['WATER','MEAL','EXERCISE','SLEEP'].includes(l.type));
                const logsSummary = yesterdayLogs.length > 0 ? yesterdayLogs.map(l => `[${new Date(l.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute:'2-digit' })}] ${l.type}${l.description ? `: ${l.description}`:''}`).join('\n') : "无昨日生理活动记录。";
                
                const analysis = await GeminiService.analyzeSleep(sleepDurationHours, content, logsSummary, persona, aiConfig, prompts);

                // 成功：构建晨间简报文本，提取震动标记
                const rawMorningReport = `【晨间简报】\n${analysis.greeting}\n\n**昨日回顾:**\n${analysis.summary}\n\n**状态校准:**\n⚡ 能量: ${analysis.energyLevel}%\n🧠 理智: ${analysis.sanLevel}%\n\n${analysis.buff}`;
                const sleepHaptics = extractHapticMarkers(rawMorningReport);
                const cleanMorningReport = sleepHaptics.cleanText;

                setLifeLogs(prev => prev.map(l => l.id === tempId ? {
                    ...l,
                    description: "解除休眠 (Boot Complete)",
                    status: 'SUCCESS',
                    aiAnalysis: cleanMorningReport
                } : l));
                scheduleParsedHaptics(sleepHaptics, 'sleep');

                // 应用数值
                setStats(prev => ({
                    ...prev,
                    energy: isValidNumber(analysis.energyLevel, 80),
                    san: isValidNumber(analysis.sanLevel, 80)
                }));

                // 添加 Morning Report Journal Log
                const morningReportLog: JournalLog = {
                    id: Date.now().toString(),
                    timestamp: Date.now(),
                    content: `[系统日志] 睡眠周期结束。时长: ${sleepDurationHours.toFixed(1)}h。主观感受: ${content}`,
                    aiReply: cleanMorningReport,
                    coinsEarned: 0,
                    moodTag: "REBOOT"
                };
                setLogs(prev => [morningReportLog, ...prev]);
                showNotification("SYSTEM", "系统校准完成。新的一天已加载。");
            }
        } catch (e: any) {
            // 失败：更新日志状态为 FAILED，保留 rawInput 供重试
            console.error("Bio Log Failed:", e);
            setLifeLogs(prev => prev.map(l => l.id === tempId ? { ...l, status: 'FAILED' } : l));
            showNotification("SCAN ERROR", "分析模块离线。记录已保存，请在 BIO 页面点击红色条目重试。");
        } finally {
            setIsBioAnalyzing(false);
        }
        return;
    }

    // 2. 处理无需 AI 的简单类型 (WATER / SLEEP / EXERCISE)
    const newLog: LifeLog = { 
        id: Date.now().toString(), 
        timestamp: Date.now(), 
        type, 
        description: content,
        status: 'SUCCESS' // 简单类型默认成功
    };
    setLifeLogs(prev => [newLog, ...prev]); 

    setStats(prev => {
        let { energy, san, coins } = prev;
        if (type === 'WATER') energy = Math.min(100, energy + 5); 
        else if (type === 'SLEEP') san = Math.min(100, san + 10);
        else if (type === 'NAP') { energy = Math.min(100, energy + 5); san = Math.min(100, san + 5); }
        else if (type === 'EXERCISE') { energy = Math.max(0, energy - 15); san = Math.min(100, san + 10); coins += 30; }
        return { ...prev, energy, san, coins,
          lastDrinkTime: type === 'WATER' ? Date.now() : prev.lastDrinkTime,
          lastMealTime: (type as string) === 'MEAL' ? Date.now() : prev.lastMealTime
        };
    });
    
    const messages = ENCOURAGEMENTS[type as keyof typeof ENCOURAGEMENTS] || ["Log Updated."];
    showNotification("BIO-FEEDBACK", messages[Math.floor(Math.random() * messages.length)], { hapticEmotion: ENCOURAGEMENT_HAPTICS[type] });
  };

  const handleRetryLifeLog = (log: LifeLog) => {
      // 只有 FAILED 的日志才能重试
      if (log.status !== 'FAILED' || !log.rawInput) return;
      
      // 删除旧的 FAILED 日志 (handleLifeLogRecord 会创建新的)
      setLifeLogs(prev => prev.filter(l => l.id !== log.id));
      
      // 重新触发记录流程
      handleLifeLogRecord(log.type, log.rawInput);
  };

  const handleUpdateCycleDayLog = (log: CycleDayLog) => {
    setCycleDayLogs(prev => {
        const index = prev.findIndex(l => l.date === log.date);
        const newLogs = [...prev];
        if (index > -1) {
            // If the new log is empty, remove it
            if (log.flow === 'none' && log.pain.length === 0 && log.mood.length === 0 && (!log.notes || log.notes.trim() === '')) {
                newLogs.splice(index, 1);
                showNotification("SYSTEM", `Cycle data for ${log.date} cleared.`);
            } else {
                newLogs[index] = log;
                showNotification("BIO-FEEDBACK", `Cycle data for ${log.date} updated.`);
            }
        } else {
            // Don't add if it's an empty log
            if (log.flow !== 'none' || log.pain.length > 0 || log.mood.length > 0 || (log.notes && log.notes.trim() !== '')) {
                newLogs.push(log);
                showNotification("BIO-FEEDBACK", `Cycle data for ${log.date} logged.`);
            }
        }
        return newLogs;
    });
  };

  const handleCreateSession = (name: string): ChatSession => { const newSession: ChatSession = { id: Date.now().toString(), name, messages: [], lastModified: Date.now() }; setChatSessions(prev => [newSession, ...prev]); return newSession; };
  const handleSaveSession = (updatedSession: ChatSession) => setChatSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
  const handleDeleteSession = (sessionId: string) => setChatSessions(prev => prev.filter(s => s.id !== sessionId));

  const triggerAvatarInteraction = async () => {
    if (Date.now() - lastInteractionTimeRef.current < 5000) return;
    lastInteractionTimeRef.current = Date.now();
    const { isSleepTime, overtimeMins } = checkSleepStatus();
    if (isSleepTime && !isSleeping) {
        const overtimeStr = `${Math.floor(overtimeMins / 60)}小时${overtimeMins % 60}分`;
        const msg = await GeminiService.generateToxicNotification('sleep', persona, aiConfig, prompts, overtimeStr);
        showNotification("SYSTEM ALERT", msg);
        return;
    } 
    setStats(prev => {
        const sanGain = prev.san < 90 ? 3 : 0; 
        if (sanGain > 0) { setTimeout(() => showNotification("BIO-FEEDBACK", "深呼吸检测完毕。皮质醇水平微降。", { hapticEmotion: 'gentle' }), 200); return { ...prev, san: Math.min(100, prev.san + sanGain) }; }
        else { showNotification("SYSTEM", "精神状态稳定。无需干预。"); return prev; }
    });
  };

  const handleExportData = async () => {
    const backupData: BackupData = { version: "1.0", persona, aiConfig, savedConnectionProfiles, savedPresets, savedPromptPresets, stats, logs, memoryBank, lifeLogs, cycleDayLogs, gachaItems, chatSessions, prompts, notificationLogs };
    const jsonString = JSON.stringify(backupData, null, 2);
    const fileName = `negentropy_terminal_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

    if (Capacitor.isNativePlatform()) {
        try {
            const result = await Filesystem.writeFile({
                path: fileName,
                data: jsonString,
                directory: Directory.Cache, 
                encoding: Encoding.UTF8,
            });
            await Share.share({
                title: 'Export Terminal Data',
                text: '逆熵终端备份文件',
                url: result.uri,
                dialogTitle: '保存或分享备份',
            });
        } catch (error: any) {
            if (error.message && error.message.toLowerCase().includes('canceled')) {
                return;
            }
            console.error('Unable to export file', error);
            showNotification("EXPORT FAILED", `Could not save file. Reason: ${error.message}`);
        }
    } else {
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification("SYSTEM", "Data export initiated.");
    }
  };

  const handleImportData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result; if (typeof text !== 'string') throw new Error("Invalid file content");
            const data = JSON.parse(text) as BackupData;
            if (!data.version || !data.stats || !data.logs || !data.persona) throw new Error("Invalid backup file format.");
            if (window.confirm("WARNING:\nImporting will overwrite all current data. This action cannot be undone. Proceed?")) {
                setPersona(data.persona); setAiConfig(normalizeAiConfig(data.aiConfig)); setSavedConnectionProfiles((data.savedConnectionProfiles || []).map(normalizeConnectionProfile)); setSavedPresets(data.savedPresets || []); setStats(data.stats); setLogs(data.logs || []); setLifeLogs(sanitizeStoredLifeLogs(data.lifeLogs || [])); setGachaItems(data.gachaItems || []); setChatSessions((data.chatSessions || []).map(normalizeChatSessionRecord));
                if (data.prompts) setPrompts(data.prompts);
                if (data.savedPromptPresets) setSavedPromptPresets(data.savedPromptPresets);
                if (data.memoryBank) setMemoryBank(data.memoryBank);
                if (data.cycleDayLogs) setCycleDayLogs(data.cycleDayLogs);
                if (data.notificationLogs) setNotificationLogs(data.notificationLogs);
                showNotification("SYSTEM", "Data imported successfully. Application will reload.");
                setTimeout(() => window.location.reload(), 1500);
            }
        } catch (error: any) { showNotification("ERROR", `Import failed: ${error.message}`); } 
        finally { event.target.value = ''; }
    };
    reader.readAsText(file);
  };

  const handleRunStreamProbe = async (probeConfig: AIConfig) => {
    setIsStreamProbeRunning(true);
    try {
      const diagnostics = await GeminiService.runStreamingProbe(persona, normalizeAiConfig(probeConfig), prompts);
      setStreamDiagnostics(diagnostics);
      appendDiagnosticsLog({
        domain: 'stream',
        source: 'probe',
        status: diagnostics.lastError ? 'error' : 'success',
        message: diagnostics.lastError
          ? `Streaming probe failed: ${diagnostics.lastError}`
          : `Streaming probe completed via ${diagnostics.transport}.`,
        attempt: diagnostics.chunkCount,
        details: diagnostics.previewText || `status=${diagnostics.statusCode ?? '-'} / firstChunk=${diagnostics.firstChunkMs ?? '-'}ms`,
      });
      if (diagnostics.lastError) {
        showNotification("STREAM PROBE", `流式诊断失败: ${diagnostics.lastError}`, { source: 'probe_ui' });
      } else {
        const chunkSummary = diagnostics.chunkCount > 1 ? `多段流正常 (${diagnostics.chunkCount} chunks)` : `疑似整包返回 (${diagnostics.chunkCount} chunk)`;
        showNotification("STREAM PROBE", `${diagnostics.transport} / ${chunkSummary}`, { source: 'probe_ui' });
      }
    } catch (error: any) {
      const message = error?.message || String(error);
      appendDiagnosticsLog({
        domain: 'stream',
        source: 'probe',
        status: 'error',
        message: 'Streaming probe threw an exception.',
        details: message,
      });
      showNotification("STREAM PROBE", `流式诊断异常: ${message}`, { source: 'probe_ui' });
    } finally {
      setIsStreamProbeRunning(false);
    }
  };

  const handleRunHapticTest = async () => {
    setIsHapticProbeRunning(true);
    try {
      const diagnostics = await runHapticDiagnosticProbe('warning');
      setHapticDiagnostics(diagnostics);
      const nativeStatus = diagnostics.nativeStatus;
      const backendLabel = diagnostics.lastBackend || 'unknown';
      appendDiagnosticsLog({
        domain: 'haptic',
        source: 'probe',
        status: diagnostics.lastError ? 'error' : 'success',
        message: diagnostics.lastError
          ? `Haptic probe failed: ${diagnostics.lastError}`
          : `Haptic probe completed via ${backendLabel}.`,
        backend: backendLabel,
        emotion: diagnostics.lastEmotion || null,
        markerDetected: true,
        details: `bridge=${nativeStatus?.bridgeReady ? 'READY' : 'MISSING'} / vibrator=${nativeStatus?.hasVibrator ? 'YES' : 'NO'}`,
      });
      if (diagnostics.lastError) {
        showNotification("HAPTIC TEST", `后端: ${backendLabel}\n错误: ${diagnostics.lastError}`, { source: 'probe_ui' });
      } else {
        showNotification(
          "HAPTIC TEST",
          `后端: ${backendLabel}\n桥接: ${nativeStatus?.bridgeReady ? 'READY' : 'MISSING'} / 振子: ${nativeStatus?.hasVibrator ? 'YES' : 'NO'}`,
          { source: 'probe_ui' }
        );
      }
    } catch (error: any) {
      const message = error?.message || String(error);
      appendDiagnosticsLog({
        domain: 'haptic',
        source: 'probe',
        status: 'error',
        message: 'Haptic probe threw an exception.',
        markerDetected: true,
        details: message,
      });
      showNotification("HAPTIC TEST", `震动诊断异常: ${message}`, { source: 'probe_ui' });
    } finally {
      setIsHapticProbeRunning(false);
    }
  };

  const submitWakeUp = (e: React.FormEvent) => { e.preventDefault(); if (!wakeFeeling.trim() || isBioAnalyzing) return; handleLifeLogRecord('WAKE_UP', wakeFeeling); setIsWakeUpModalOpen(false); setWakeFeeling(''); };
  
  const handleAddMemory = (memory: MemoryLog, coins: number) => {
      setMemoryBank(prev => [memory, ...prev]);
      setStats(prev => ({ ...prev, coins: prev.coins + coins }));
  };
  
  const handleDeleteMemory = (id: string) => {
      setMemoryBank(prev => prev.filter(m => m.id !== id));
      showNotification("SYSTEM", "Memory deleted.");
  };

  const handleUpdateMemory = (id: string, newContent: string) => {
      setMemoryBank(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));
      showNotification("SYSTEM", "Memory updated.");
  };

  const handleToggleMemoryEnabled = (id: string) => {
      setMemoryBank(prev => prev.map(m => m.id === id ? { ...m, enabled: m.enabled === false } : m));
  };

  // Wake Lock Logic to keep app alive in foreground
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        // Only attempt if the API exists and the document is focused/visible to avoid common NotAllowedErrors
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          wakeLock = await (navigator as any).wakeLock.request('screen');
          console.log('Wake Lock is active');
        }
      } catch (err: any) {
        // Silence the specific "disallowed by permissions policy" error as it's environment-dependent
        if (err.name !== 'NotAllowedError') {
          console.error(`WakeLock Error: ${err.name}, ${err.message}`);
        } else {
          console.warn('Wake Lock request was denied by permissions policy or lack of user interaction.');
        }
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) wakeLock.release();
    };
  }, []);

  const renderHUD = () => (
    <div className="bg-[#050505]/90 backdrop-blur-md border-b border-green-900/50 p-3 shadow-lg z-50">
       <div className="flex justify-between items-center mb-3">
         <div className="flex flex-col"><span className="text-[9px] text-green-700 tracking-[0.2em] font-bold">NEGENTROPY_TERMINAL_V3.5</span><span className="text-[9px] text-gray-600 font-mono">{new Date().toLocaleDateString()} // {new Date().toLocaleTimeString()}</span></div>
         <div className="flex items-center gap-3">
             <button 
                onClick={() => setIsNotificationInboxOpen(true)}
                className="relative text-green-500 hover:text-white transition-colors p-1"
                title="Open Inbox"
             >
                <Mail size={16} />
                {notificationLogs.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_5px_red]"></span>
                )}
             </button>
             <div className="flex items-center gap-2 bg-yellow-900/10 px-3 py-1 border border-yellow-900/50 clip-corner-sm"><span className="text-yellow-500 font-bold font-mono text-lg">{isValidNumber(stats.coins).toFixed(0)}</span><span className="text-[9px] text-yellow-700 uppercase tracking-widest">CREDITS</span></div>
         </div>
       </div>
       <div className="grid grid-cols-2 gap-4">
         <div className="space-y-1"><div className="flex justify-between text-[9px] text-gray-500 uppercase tracking-wider font-bold"><span className={stats.san < 30 ? 'text-red-500 animate-pulse' : 'text-blue-400'}>Sanity</span><span>{isValidNumber(stats.san).toFixed(1)}%</span></div><SegmentedBar value={stats.san} colorClass={stats.san < 30 ? 'bg-red-500' : 'bg-blue-500'} /></div>
         <div className="space-y-1"><div className="flex justify-between text-[9px] text-gray-500 uppercase tracking-wider font-bold"><span className={stats.energy < 30 ? 'text-red-500 animate-pulse' : 'text-green-400'}>Energy</span><span>{isValidNumber(stats.energy).toFixed(1)}%</span></div><SegmentedBar value={stats.energy} colorClass={stats.energy < 30 ? 'bg-red-500' : 'bg-green-500'} /></div>
       </div>
    </div>
  );

  const renderContent = () => {
    if (currentNav.view === AppView.FOCUS) return <FocusSession durationMinutes={45} onSuccess={handleFocusSuccess} onFail={handleFocusFail} onAbort={handleFocusAbort} onBack={() => switchMainView(AppView.DASHBOARD)} onStatusChange={setIsFocusActive} />;
    
    if (currentNav.view === AppView.BIO) return <BioMonitor 
        logs={todayBioLogs} 
        onRecord={handleLifeLogRecord} 
        persona={persona} 
        isAnalyzing={isBioAnalyzing} 
        analysisResult={foodAnalysisResult} 
        onCloseAnalysis={() => setFoodAnalysisResult(null)} 
        onWakeUp={() => setIsWakeUpModalOpen(true)} 
        isSleeping={isSleeping} 
        onRetry={handleRetryLifeLog}
        onNavigateToCycleTracker={() => switchMainView(AppView.CYCLE_TRACKER)}
        // Stack Nav Props
        selectedLog={currentNav.bioSelectedLog || null}
        onSelectLog={(log) => navigate({ bioSelectedLog: log })}
        onCloseLogDetail={goBack}
        isFoodInputOpen={currentNav.isBioFoodInputOpen}
        onOpenFoodInput={() => navigate({ isBioFoodInputOpen: true })}
        onCloseFoodInput={goBack}
    />;

    if (currentNav.view === AppView.CYCLE_TRACKER) return <CycleTracker 
      logs={cycleDayLogs} 
      onUpdateLog={handleUpdateCycleDayLog} 
      onBack={() => switchMainView(AppView.BIO)} 
    />;
    
    if (currentNav.view === AppView.LOGS_ARCHIVE) return <LogArchive logs={logs} onUpdateLog={handleUpdateLog} onDeleteLog={handleDeleteLog} onRegenerateLog={handleRegenerateJournalReply} onBack={() => switchMainView(AppView.DASHBOARD)} />;
    
    if (currentNav.view === AppView.SETTINGS) return <div className="flex flex-col h-full overflow-hidden"><div className="p-4 border-b border-gray-800"><label className="block text-xs text-gray-500 mb-2 font-bold tracking-widest">AI_PERSONALITY_MODULE (快速切换)</label><div className="flex gap-2"><button onClick={() => setPersona(PRESETS.GENTLE)} className={`flex-1 p-3 text-xs border clip-corner-sm transition-all ${persona.name.includes("医疗") ? 'bg-blue-900/30 border-blue-500 text-blue-400' : 'border-gray-800 text-gray-500'}`}><div className="font-bold text-sm mb-1">温柔医疗伴侣</div><div className="scale-75 origin-top-left">适合高压/焦虑</div></button><button onClick={() => setPersona(PRESETS.STRICT)} className={`flex-1 p-3 text-xs border clip-corner-sm transition-all ${!persona.name.includes("医疗") ? 'bg-green-900/30 border-green-500 text-green-400' : 'border-gray-800 text-green-400'}`}><div className="font-bold text-sm mb-1">严厉观测者</div><div className="scale-75 origin-top-left">适合冲刺DDL</div></button></div></div><Settings config={persona} aiConfig={aiConfig} prompts={prompts} appPreferences={appPreferences} savedPresets={savedPresets} savedPromptPresets={savedPromptPresets} savedConnectionProfiles={savedConnectionProfiles} streamDiagnostics={streamDiagnostics} hapticDiagnostics={hapticDiagnostics} diagnosticsLogs={diagnosticsLogs} isStreamProbeRunning={isStreamProbeRunning} isHapticProbeRunning={isHapticProbeRunning} showDiagnostics={Capacitor.isNativePlatform()} onRunStreamProbe={handleRunStreamProbe} onRunHapticTest={handleRunHapticTest} onClearDiagnosticsLogs={handleClearDiagnosticsLogs} onUpdateAppPreferences={(nextPreferences) => setAppPreferences(nextPreferences)} onSave={(c, ac, p) => { setPersona(c); setAiConfig(normalizeAiConfig(ac)); setPrompts(p); switchMainView(AppView.DASHBOARD); }} onSaveAsPreset={(c) => { setSavedPresets([...savedPresets, c]); showNotification("SYSTEM", "人设预案已保存"); }} onSaveConnectionProfile={(p) => { const newProfile = normalizeConnectionProfile({ ...p, id: Date.now().toString() }); setSavedConnectionProfiles([...savedConnectionProfiles, newProfile]); showNotification("SYSTEM", "连接配置已存档"); }} onDeleteConnectionProfile={(id) => setSavedConnectionProfiles(savedConnectionProfiles.filter(p => p.id !== id))} onDeletePreset={(idx) => setSavedPresets(savedPresets.filter((_, i) => i !== idx))} onApplyPreset={(c) => setPersona(c)} onSavePromptPreset={(name, p) => { setSavedPromptPresets([...savedPromptPresets, { id: Date.now().toString(), name, prompts: p }]); showNotification("SYSTEM", "指令预设已保存"); }} onDeletePromptPreset={(id) => setSavedPromptPresets(savedPromptPresets.filter(p => p.id !== id))} onApplyPromptPreset={(p) => setPrompts(p)} onBack={() => switchMainView(AppView.DASHBOARD)} onExportData={handleExportData} onImportData={handleImportData}/></div>;
    
    if (currentNav.view === AppView.SHOP) return <ShopInterface 
        stats={stats} persona={persona} aiConfig={aiConfig} prompts={prompts} customItems={gachaItems} onUpdateStats={setStats} onUpdateItems={setGachaItems} showNotification={showNotification}
        // Stack Nav Props
        gachaResult={currentNav.shopGachaResult || null}
        setGachaResult={(res) => res ? navigate({ shopGachaResult: res }) : goBack()}
    />;
    
      if (currentNav.view === AppView.CHAT) return <ChatInterface 
          config={persona} aiConfig={aiConfig} prompts={prompts} recentLogs={logs} memoryBank={memoryBank} todayBioLogs={todayBioLogs} cycleDayLogs={cycleDayLogs} unlockedTurns={stats.unlockedChatTurns} onTurnUsed={() => {}} 
          sessions={chatSessions} onCreateSession={handleCreateSession} onSaveSession={handleSaveSession} onDeleteSession={handleDeleteSession} showNotification={showNotification} onAddMemory={handleAddMemory} onDeleteMemory={handleDeleteMemory} 
          onUpdateMemory={handleUpdateMemory}
          onToggleMemoryEnabled={handleToggleMemoryEnabled}
          // New Props for Lifted State
          onSendMessage={handleChatSendMessage}
          onRegenerateMessage={handleChatRegenerateMessage}
          onRetryMessage={handleRetryChatMessage}
          isThinking={chatThinkingSessionId === currentNav.chatSessionId}
          canStopGeneration={activeStreamingSessionId === currentNav.chatSessionId}
          onStopGeneration={() => currentNav.chatSessionId && handleStopStreamingOutput(currentNav.chatSessionId)}
          // Stack Nav Props
          activeSessionId={currentNav.chatSessionId || null}
        isMemoryBankOpen={currentNav.isChatMemoryBankOpen}
        isManualMemoryOpen={currentNav.isChatManualMemoryOpen}
        onSelectSession={(id) => navigate({ chatSessionId: id })}
        onOpenMemoryBank={() => navigate({ isChatMemoryBankOpen: true })}
        onCloseMemoryBank={goBack}
        onOpenManualMemory={() => navigate({ isChatManualMemoryOpen: true })}
        onCloseManualMemory={goBack}
        onBack={() => {
            if (currentNav.chatSessionId) {
                // If deep in session, simple goBack() pops the session ID, returning to list
                goBack();
            } else {
                // If at list, go back to Dashboard
                switchMainView(AppView.DASHBOARD);
            }
        }}
    />;

    return (
        <div className="p-4 space-y-8 pb-32 h-full overflow-y-auto custom-scrollbar">
            <div className="flex flex-col items-center justify-center pt-4" onClick={triggerAvatarInteraction}><div className="relative w-32 h-32 flex items-center justify-center cursor-pointer group"><div className={`absolute inset-0 border-2 rounded-full border-dashed animate-[spin_8s_linear_infinite] opacity-30 ${stats.san < 30 ? 'border-red-500' : 'border-green-500'}`}></div><div className={`absolute inset-2 border rounded-full animate-[spin_4s_linear_infinite_reverse] opacity-20 ${stats.san < 30 ? 'border-red-500' : 'border-green-400'}`}></div><div className={`w-20 h-20 rounded-full flex items-center justify-center border shadow-[0_0_20px_currentColor] transition-colors duration-500 bg-black ${stats.san < 30 ? 'border-red-500 text-red-500 bg-red-950/20' : 'border-green-500 text-green-500 bg-green-950/20'}`}><div className={`w-12 h-1 transition-all duration-300 ${stats.san < 30 ? 'bg-red-500 rotate-45 w-1 h-12' : 'bg-green-400 group-hover:h-8 group-hover:w-8 group-hover:rounded-full'}`}></div></div><div className="absolute -bottom-6 bg-black border border-gray-800 px-3 py-0.5 text-[9px] text-gray-400 tracking-widest clip-corner-sm">STATUS: {stats.san < 30 ? 'UNSTABLE' : 'OPTIMAL'}</div></div>
                {stats.unlockedChatTurns > 0 && (<div onClick={() => switchMainView(AppView.CHAT)} className="mt-6 bg-blue-900/20 border border-blue-500/50 px-4 py-2 rounded-full text-xs text-blue-300 cursor-pointer hover:bg-blue-900/40 animate-bounce flex items-center gap-2"><div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div><span>收到新讯息 (点击接入)</span></div>)}
            </div>
             {proactiveMessage && (
              <div className="bg-blue-900/20 border border-blue-500/50 p-4 clip-corner-sm space-y-3 animate-[fadeIn_0.5s]">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold tracking-widest text-blue-300">[INCOMING TRANSMISSION from {persona.name}]</h3>
                  <button onClick={() => setProactiveMessage(null)} className="text-gray-500 hover:text-white">&times;</button>
                </div>
                <MarkdownText text={proactiveMessage} className="text-sm text-blue-100/90" highlightColor="text-blue-300" />
                <div className="flex justify-end">
                  <button onClick={() => setProactiveMessage(null)} className="text-[10px] bg-blue-900/50 text-blue-300 px-3 py-1 border border-blue-800 hover:bg-blue-800 hover:text-white transition-colors">[ACKNOWLEDGE]</button>
                </div>
              </div>
            )}
            <TerminalInput onSubmit={handleJournalSubmit} isProcessing={isProcessing} />
            <div className="space-y-3 relative">
                <div className="flex justify-between items-end border-b border-gray-800 pb-2 mb-4"><div className="flex items-center gap-2"><div className="w-1 h-4 bg-green-600"></div><h3 className="text-xs text-gray-500 tracking-[0.2em] font-bold">MEMORY_LOGS</h3></div><button onClick={() => switchMainView(AppView.LOGS_ARCHIVE)} className="text-[10px] text-green-500 hover:text-white border border-green-900/50 px-2 py-0.5 clip-corner-sm hover:bg-green-900/30 transition-all flex items-center gap-1"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>EXPAND / SEARCH</button></div>
                <div className="max-h-80 overflow-y-auto pr-1 custom-scrollbar space-y-3">
                    {logs.slice(0, 5).length === 0 && (<div className="text-center border border-gray-800 border-dashed p-8 rounded text-gray-700 text-xs font-mono">NO_DATA_FOUND // AWAITING_INPUT</div>)}
                    {logs.slice(0, 5).map(log => (<div key={log.id} className="relative bg-[#0a0a0a] p-4 border border-green-900/30 hover:border-green-500/50 transition-colors group clip-corner-sm"><div className="absolute left-0 top-0 bottom-0 w-1 bg-green-900 group-hover:bg-green-500 transition-colors"></div><div className="flex justify-between items-start mb-2 pl-2"><div className="text-[9px] text-gray-600 font-mono">{new Date(log.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</div><div className="flex items-center gap-2"><div className="text-[9px] text-green-800 bg-green-900/20 px-2 rounded-sm border border-green-900/30">TAG: {log.moodTag}</div><div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => { setEditingLogId(log.id); setEditText(log.content); }} className="text-[9px] text-yellow-500 hover:text-white">[EDIT]</button><button onClick={() => handleRegenerateJournalReply(log.id)} className="text-[9px] text-cyan-500 hover:text-white">[REGEN]</button><button onClick={() => handleDeleteLog(log.id)} className="text-[9px] text-red-600 hover:text-red-400">[DELETE]</button></div></div></div>
                            {editingLogId === log.id ? (<div className="pl-2"><textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="w-full h-24 bg-black border border-green-800 text-green-100 p-2 text-sm font-mono focus:border-green-400 outline-none resize-none placeholder-green-900/50" autoFocus/><div className="flex justify-end gap-2 mt-2"><button onClick={() => setEditingLogId(null)} className="text-xs text-gray-500 hover:text-white px-2 py-1">Cancel</button><button onClick={() => handleUpdateLog(log.id, editText)} className="text-xs bg-green-800 text-white px-3 py-1 hover:bg-green-700">Save</button></div></div>) : (<><div className="pl-2 text-sm text-gray-300 font-light mb-3 leading-relaxed opacity-90 whitespace-pre-wrap">{log.content}</div><div className="pl-2 pt-3 border-t border-gray-900 flex flex-col gap-1"><div className="flex items-start gap-2"><span className="text-green-600 mt-1">›</span><MarkdownText text={log.aiReply.replace(/\\n/g, '\n')} className="text-green-500 text-xs font-mono" /></div><div className="self-end text-yellow-600 text-[10px] font-mono border border-yellow-900/30 px-1 mt-1">+{log.coinsEarned} CR</div></div></>)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#050505] text-gray-200 font-sans relative select-none overflow-hidden">
        {!isSleeping && ( <> {currentNav.view !== AppView.FOCUS && renderHUD()} <div className="flex-1 overflow-y-auto custom-scrollbar relative">{renderContent()}</div> {( !isFocusActive && (currentNav.view === AppView.DASHBOARD || currentNav.view === AppView.BIO || currentNav.view === AppView.SHOP || currentNav.view === AppView.SETTINGS || currentNav.view === AppView.LOGS_ARCHIVE || currentNav.view === AppView.FOCUS || currentNav.view === AppView.CYCLE_TRACKER)) && (<div className="bg-[#050505] border-t border-green-900/30 h-16 flex justify-around items-center px-2 z-20 relative shrink-0"><button onClick={() => switchMainView(AppView.DASHBOARD)} className={`p-2 rounded-lg transition-all ${currentNav.view === AppView.DASHBOARD ? 'text-green-500 bg-green-900/20 shadow-[0_0_10px_rgba(0,255,65,0.2)]' : 'text-gray-600 hover:text-green-400'}`}><Icons.Terminal /></button><button onClick={() => switchMainView(AppView.BIO)} className={`p-2 rounded-lg transition-all ${currentNav.view === AppView.BIO || currentNav.view === AppView.CYCLE_TRACKER ? 'text-cyan-400 bg-cyan-900/20 shadow-[0_0_10px_rgba(34,211,238,0.2)]' : 'text-gray-600 hover:text-cyan-400'}`}><Icons.Bio /></button><button onClick={() => switchMainView(AppView.FOCUS)} className={`p-3 rounded-full -mt-6 border-4 border-black transition-all ${currentNav.view === AppView.FOCUS ? 'bg-green-600 text-black shadow-[0_0_20px_rgba(0,255,65,0.6)] scale-110' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}><Icons.Focus /></button><button onClick={() => switchMainView(AppView.SHOP)} className={`p-2 rounded-lg transition-all ${currentNav.view === AppView.SHOP ? 'text-yellow-500 bg-yellow-900/20 shadow-[0_0_10px_rgba(234,179,8,0.2)]' : 'text-gray-600 hover:text-yellow-400'}`}><Icons.Shop /></button><button onClick={() => switchMainView(AppView.SETTINGS)} className={`p-2 rounded-lg transition-all ${currentNav.view === AppView.SETTINGS ? 'text-gray-200 bg-gray-800' : 'text-gray-600 hover:text-white'}`}><Icons.Settings /></button></div>)} </>)}
        {isSleeping && (<div className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center animate-[fadeIn_0.5s] space-y-8"><div className="text-center space-y-2"><h2 className="text-3xl text-purple-400 font-bold tracking-[0.2em] font-[Orbitron]">STASIS_MODE</h2><p className="text-purple-700 text-xs font-mono animate-pulse">RESTORING_NEURAL_PATHWAYS...</p></div><button onClick={() => setIsWakeUpModalOpen(true)} className="px-8 py-4 bg-green-600 text-black font-bold text-lg clip-corner hover:bg-green-500 transition-colors shadow-[0_0_20px_rgba(0,255,65,0.4)]">WAKE UP</button></div>)}
        {isWakeUpModalOpen && (<div className="fixed inset-0 z-[210] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"><div className="w-full max-w-sm border border-green-600 bg-[#0a0a00] p-1 clip-corner shadow-[0_0_30px_rgba(0,255,65,0.2)]"><div className="bg-green-900/20 p-4 border border-green-900/50 h-full flex flex-col"><div className="flex justify-between items-center mb-4"><h3 className="text-green-500 font-bold font-[Orbitron] tracking-widest animate-pulse">SYSTEM_BOOT</h3><button onClick={() => setIsWakeUpModalOpen(false)} className="text-gray-500 hover:text-white">CANCEL</button></div><div className="text-xs text-green-700 mb-4 font-mono leading-relaxed">检测到生命体解除休眠。<br/>正在校准今日能量水平...<br/><span className="text-green-400">请如实反馈当前机体状态。</span></div><form onSubmit={submitWakeUp} className="flex flex-col gap-4"><textarea value={wakeFeeling} onChange={(e) => setWakeFeeling(e.target.value)} placeholder="例如：满血复活！ / 还是很困... / 头痛欲裂" className="w-full h-32 bg-black border border-green-800 text-green-100 p-2 text-sm font-mono focus:border-green-400 outline-none resize-none placeholder-green-900/50" autoFocus /><button type="submit" className="bg-green-600 text-black font-bold py-3 uppercase tracking-widest hover:bg-green-500 clip-corner-sm">CALIBRATE STATS</button></form></div></div></div>)}
        {isNotificationInboxOpen && (
            <NotificationInbox 
                notifications={notificationLogs} 
                onClose={() => setIsNotificationInboxOpen(false)} 
                onDelete={handleDismissNotification}
                onClearAll={handleClearAllNotifications}
                onToggleBookmark={handleToggleBookmark}
            />
        )}
        {logToDelete && (<div className="fixed inset-0 z-[101] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.2s]"><div className="w-full max-w-sm border border-red-500 bg-[#1a0505] p-1 clip-corner shadow-[0_0_30px_rgba(255,0,60,0.3)]"><div className="bg-red-900/20 p-6 border border-red-900/50 h-full flex flex-col items-center text-center"><div className="w-12 h-12 flex items-center justify-center rounded-full border border-red-500/50 bg-black mb-4"><svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div><h3 className="text-red-400 font-bold font-[Orbitron] tracking-widest mb-2">CONFIRM DELETION</h3><p className="text-sm text-gray-300 mb-6 font-mono">This memory log will be permanently erased from all records. This action is irreversible. Proceed?</p><div className="flex w-full gap-4"><button onClick={cancelDeleteLog} className="flex-1 py-3 bg-gray-700 text-gray-200 hover:bg-gray-600 font-bold tracking-widest clip-corner-sm transition-colors">CANCEL</button>{/* FIX: Changed confirmDelete to confirmDeleteLog to match the function name. */}<button onClick={confirmDeleteLog} className="flex-1 py-3 bg-red-600 text-white hover:bg-red-500 font-bold tracking-widest clip-corner-sm transition-colors">DELETE</button></div></div></div></div>)}
        {notification && (<div className="fixed top-20 left-1/2 -translate-x-1/2 z-[220] w-[85%] max-w-[320px] animate-[fadeIn_0.3s_ease-out] pointer-events-none"><div className="bg-black border border-green-900/50 border-l-4 border-l-green-500 shadow-[0_0_15px_rgba(0,255,65,0.15)] p-3 relative clip-corner-sm backdrop-blur-sm pointer-events-auto"><h3 className="text-green-500 font-bold font-mono tracking-widest text-xs mb-1.5 uppercase">{notification.title}</h3><div className="h-px bg-green-900/50 w-full mb-2"></div><p className="text-gray-200 text-xs font-mono leading-relaxed whitespace-pre-wrap">{notification.content}</p></div></div>)}
    </div>
  );
}

