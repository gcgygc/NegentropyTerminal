

// 核心数据模型

// 新增：AI 连接配置
export interface AIConfig {
  provider: 'gemini' | 'openai' | 'deepseek' | 'custom';
  apiKey: string;
  baseUrl?: string; // 可选，Gemini 默认为空，其他需要
  modelId: string;  // 例如 gemini-3-flash-preview 或 deepseek-chat
  notificationProvider?: 'gemini' | 'openai' | 'deepseek' | 'custom'; // 新增：通知专用服务商
  notificationApiKey?: string; // 新增：通知专用 API Key (可选)
  notificationBaseUrl?: string; // 新增：通知专用 Base URL (可选)
  notificationModelId?: string; // 新增：通知专用模型 (可选，用于节省成本)
  enableStreaming?: boolean; // 流式输出开关 (默认 true)
}

export interface AppPreferences {
  hapticsEnabled: boolean;
}

// 新增：保存的连接配置档案
export interface ConnectionProfile extends AIConfig {
  id: string;
  name: string; // 用户自定义名称，如 "DeepSeek-V3"
}

export interface PersonaConfig {
  name: string;
  description: string; // 核心人设
  worldLore: string;   // 世界书设定
  voiceTone: string;   // 语气
  targetSleepTime: string; // 入睡时间 (格式 HH:mm)
  wakeUpTime: string;      // 新增：起床时间 (格式 HH:mm)，构成完整区间
  
  // --- V2.0 新增功能 ---
  waterReminderMode: 'SMART' | 'INTERVAL' | 'OFF'; // 喝水提醒模式
  waterReminderInterval: number; // 固定间隔模式下的分钟数
  userRole: string; // 用户身份 (如：研究生、程序员)
  currentGoal: string; // 当前目标 (如：写完论文、减肥)

  // --- V3.5 新增功能: 记忆深度控制 ---
  memoryRecallLimit?: number; // 长期记忆回溯数量 (0 = 全部, 默认 20)
  journalRecallLimit?: number; // 短期日志回溯数量 (默认 5)
  archiveRecallLimit?: number; // 聊天档案回溯数量 (0 = 全部, 默认 50)
}

// 新增：自定义提示词配置 (Prompt Engineering)
export interface CustomPrompts {
  system: string;          // 系统核心指令 (System Prompt)
  journal: string;         // 日志分析指令
  food: string;            // 食物分析指令
  sleep: string;           // 睡眠/晨间报告指令
  focus: string;           // 专注失败嘲讽指令
  focusSuccess?: string;    // 新增：专注成功鼓励指令
  overseer: string;        // 新增：主脑指令
  gacha: string;           // 抽奖文案指令
  notification: string;    // 毒舌通知指令
  summarize: string;       // 新增：记忆归档指令
  proactiveCheck?: string; // 新增：AI 主动检查指令
}

// 新增：提示词预设 (Prompt Presets) - 独立于人设
export interface PromptPreset {
  id: string;
  name: string;
  prompts: CustomPrompts;
}

export interface UserStats {
  coins: number;       // 金币
  san: number;         // SAN值 (0-100)
  energy: number;      // 能量 (0-100)
  unlockedChatTurns: number; // 剩余付费对话回合数
  lastDrinkTime: number;
  lastMealTime: number;  // 最近一次进食时间，用于饮水提醒错开饭后
  lastActiveTime: number; // 新增：最后活跃时间，用于计算离线期间的属性衰减
}

export interface JournalLog {
  id: string;
  timestamp: number;
  content: string;
  aiReply: string;
  coinsEarned: number;
  moodTag: string;
}

// V4.0 新增: 全局记忆库条目 (独立于 JournalLog)
export interface MemoryLog {
  id: string;
  timestamp: number;
  content: string; // 记忆内容 (Markdown)
  tags: string[];  // 标签
  source: 'CHAT_ARCHIVE' | 'MANUAL'; // 来源
  enabled?: boolean; // 是否对 AI 可见
}

// V4.2 Enhanced: Menstrual Cycle Tracking
export type MenstrualFlow = 'none' | 'spotting' | 'light' | 'medium' | 'heavy';
export type PainSymptom = 'cramps' | 'headache' | 'backache' | 'tender_breasts';
export type MoodSymptom = 'calm' | 'happy' | 'sad' | 'anxious' | 'irritable' | 'energetic';

export interface CycleDayLog {
  date: string; // YYYY-MM-DD
  flow: MenstrualFlow;
  pain: PainSymptom[];
  mood: MoodSymptom[];
  notes?: string;
}

// V4.3 New: Notification Inbox Log
export interface NotificationLog {
  id: string;
  timestamp: number;
  title: string;
  content: string;
  read: boolean; // Reserved for potential "read but keep" logic, though we delete on read currently
  isBookmarked?: boolean; // User bookmarked notifications
}


// 新增：生理日志类型
// WAKE_UP 用于标记起床事件，计算睡眠周期
export type LifeEventType = 'WATER' | 'MEAL' | 'SLEEP' | 'WAKE_UP' | 'EXERCISE' | 'NAP';

export interface LifeLog {
  id: string;
  timestamp: number;
  type: LifeEventType;
  value?: number; // 例如：毫升、卡路里、睡眠时长（分钟），预留给未来用
  description?: string; // 备注，如 "咖啡", "午餐"
  
  // V3.0 Update: 支持失败重试和历史回溯
  status?: 'PENDING' | 'SUCCESS' | 'FAILED'; 
  rawInput?: string; // 保留用户原始输入，用于重试
  aiAnalysis?: string; // 保留 AI 对该条目的具体分析（如食物评价）
  coinChange?: number; // 记录当时的金币变动
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  reasoning?: string; // 新增：用于存储 DeepSeek R1 等模型的思考过程
  timestamp: number;
  status?: 'PENDING' | 'SUCCESS' | 'FAILED'; // 新增：消息状态
  error?: string; // 新增：错误信息
  transientType?: 'streaming' | 'tool_status'; // 临时消息，仅用于流式 UI 状态
}

// 新增：聊天会话存档
export interface ChatSession {
  id: string;
  name: string; // 自定义会话名称
  messages: ChatMessage[];
  lastModified: number;
}

export interface StreamDiagnostics {
  transport: 'unknown' | 'gemini-sdk' | 'web-fetch-sse' | 'native-openai-android';
  provider?: AIConfig['provider'];
  contentType?: string;
  statusCode?: number;
  firstChunkMs?: number | null;
  chunkCount: number;
  suspectedBuffered: boolean;
  active: boolean;
  lastError?: string | null;
  lastRequestId?: string;
  previewText?: string;
  lastUpdatedAt?: number;
}

export interface NativeHapticStatus {
  bridgeReady: boolean;
  hasVibrator: boolean;
  nativeAvailable: boolean;
  lastNativeError?: string | null;
}

export interface HapticDiagnostics {
  lastEmotion?: string | null;
  lastCueType?: HapticCueType | null;
  lastBackend?: 'unknown' | 'native-bridge' | 'navigator' | 'capacitor-fallback';
  lastScheduledAt?: number | null;
  lastError?: string | null;
  nativeStatus?: NativeHapticStatus;
  lastUpdatedAt?: number;
}

export type DiagnosticsDomain = 'stream' | 'haptic' | 'bg_notification';
export type DiagnosticsStatus = 'success' | 'skipped' | 'error' | 'fallback';
export type DiagnosticsChannel = 'content' | 'utility';
export type HapticCueType = 'canonical' | 'custom' | 'synthesized';
export type DiagnosticsReason =
  | 'missing_marker'
  | 'unknown_emotion'
  | 'played'
  | 'focus_completion'
  | 'native_failed'
  | 'muted_by_user'
  | 'sleep_quiet_mode'
  | 'custom_pattern'
  | 'synthesized'
  | 'invalid_custom_pattern';

export interface DiagnosticsLogEntry {
  id: string;
  timestamp: number;
  domain: DiagnosticsDomain;
  channel?: DiagnosticsChannel;
  source: string;
  status: DiagnosticsStatus;
  message: string;
  emotion?: string | null;
  rawEmotion?: string | null;
  resolvedEmotion?: string | null;
  cueType?: HapticCueType | null;
  backend?: string | null;
  markerDetected?: boolean;
  attempt?: number;
  reason?: DiagnosticsReason | null;
  details?: string | null;
}

export interface GachaItem {
  id: string;
  name: string;
  probability?: number; // 预留权重
}

// Gemini API 响应结构
export interface JournalAnalysisResponse {
  reply: string;
  coins: number;
  mood_tag: string;
  san_change: number;
}

// 新增：食物分析响应
export interface FoodAnalysisResponse {
    analysis: string;       // AI 的毒舌或夸奖
    isHealthy: boolean;     // 是否健康
    coinChange: number;     // 金币变化（正或负）
    energyChange: number;   // 能量变化
    sanChange: number;      // SAN值变化
}

// 新增：睡眠/晨间分析响应
export interface SleepAnalysisResponse {
    greeting: string;       // 晨间问候/吐槽
    energyLevel: number;    // 今日初始能量 (0-100)
    sanLevel: number;       // 今日初始Sanity (0-100)
    buff: string;           // 获得的随机Buff/Debuff (文本描述)
    summary: string;        // 新增：对昨日生理日志的总结
}

// 新增：数据备份结构
export interface BackupData {
    version: string;
    persona: PersonaConfig;
    aiConfig: AIConfig;
    savedConnectionProfiles: ConnectionProfile[];
    savedPresets: PersonaConfig[];
    savedPromptPresets?: PromptPreset[]; // 新增：独立的提示词预设备份
    stats: UserStats;
    logs: JournalLog[];
    memoryBank?: MemoryLog[]; // 新增：记忆库备份
    lifeLogs: LifeLog[];
    cycleDayLogs?: CycleDayLog[]; // 替换 cycleLogs
    gachaItems: GachaItem[];
    chatSessions: ChatSession[];
    prompts?: CustomPrompts; // 新增：备份中包含提示词
    notificationLogs?: NotificationLog[]; // 新增：备份通知日志
}


// 流式输出 chunk 类型
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error' | 'thinking';
  text?: string;          // 增量文本
  thinkingText?: string;  // DeepSeek V4 Pro 思考过程增量文本
  toolCall?: {
    name: string;
    args: any;
    id?: string;
    _id?: string;
    extra_content?: Record<string, unknown>;
    thoughtSignature?: string;
    thought_signature?: string;
  };
  error?: string;
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  BIO = 'BIO', // 新增生物监测模块
  CYCLE_TRACKER = 'CYCLE_TRACKER', // 新增月经周期追踪
  FOCUS = 'FOCUS',
  SHOP = 'SHOP',
  SETTINGS = 'SETTINGS',
  CHAT = 'CHAT', 
  LOGS_ARCHIVE = 'LOGS_ARCHIVE', // 新增日志归档视图
}

