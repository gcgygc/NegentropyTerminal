
import React, { useEffect, useState } from 'react';
import { PersonaConfig, AIConfig, ConnectionProfile, CustomPrompts, PromptPreset, StreamDiagnostics, HapticDiagnostics, DiagnosticsLogEntry, AppPreferences } from '../types';
import * as GeminiService from '../services/geminiService';

const getDiagnosticsChannel = (entry: DiagnosticsLogEntry): 'content' | 'utility' => {
  if (entry.channel) return entry.channel;
  if (entry.domain === 'bg_notification') return 'content';
  if (entry.source === 'foreground_notification' || entry.source === 'probe' || entry.source === 'probe_ui') return 'utility';
  return 'content';
};

interface SettingsProps {
  config: PersonaConfig;
  aiConfig: AIConfig; 
  prompts: CustomPrompts; 
  appPreferences: AppPreferences;
  savedPresets: PersonaConfig[];
  savedPromptPresets?: PromptPreset[]; 
  savedConnectionProfiles: ConnectionProfile[]; 
  onSave: (newConfig: PersonaConfig, newAiConfig: AIConfig, newPrompts: CustomPrompts) => void;
  onSaveAsPreset: (newConfig: PersonaConfig) => void; 
  onDeletePreset: (index: number) => void;
  onApplyPreset: (preset: PersonaConfig) => void;
  onSaveConnectionProfile: (profile: AIConfig & { name: string }) => void; 
  onDeleteConnectionProfile: (id: string) => void; 
  onSavePromptPreset: (name: string, prompts: CustomPrompts) => void; 
  onDeletePromptPreset: (id: string) => void; 
  onApplyPromptPreset: (prompts: CustomPrompts) => void; 
  onBack: () => void;
  onExportData: () => void; 
  onImportData: (event: React.ChangeEvent<HTMLInputElement>) => void; 
  streamDiagnostics: StreamDiagnostics;
  hapticDiagnostics: HapticDiagnostics;
  diagnosticsLogs: DiagnosticsLogEntry[];
  isStreamProbeRunning: boolean;
  isHapticProbeRunning: boolean;
  showDiagnostics: boolean;
  onRunStreamProbe: (aiConfig: AIConfig) => Promise<void>;
  onRunHapticTest: () => Promise<void>;
  onClearDiagnosticsLogs: () => void;
  onUpdateAppPreferences: (preferences: Partial<AppPreferences> | AppPreferences) => void;
}

export const Settings: React.FC<SettingsProps> = ({ 
    config, 
    aiConfig,
    prompts, 
    appPreferences,
    savedPresets, 
    savedPromptPresets = [], 
    savedConnectionProfiles,
    onSave, 
    onSaveAsPreset, 
    onDeletePreset,
    onApplyPreset,
    onSaveConnectionProfile,
    onDeleteConnectionProfile,
    onSavePromptPreset,
    onDeletePromptPreset,
    onApplyPromptPreset,
    onBack,
    onExportData,
    onImportData,
    streamDiagnostics,
    hapticDiagnostics,
    diagnosticsLogs,
    isStreamProbeRunning,
    isHapticProbeRunning,
    showDiagnostics,
    onRunStreamProbe,
    onRunHapticTest,
    onClearDiagnosticsLogs,
    onUpdateAppPreferences
}) => {
  const [formData, setFormData] = useState<PersonaConfig>(config);
  const [aiFormData, setAiFormData] = useState<AIConfig>(aiConfig);
  const [promptsData, setPromptsData] = useState<CustomPrompts>(prompts); 
  const [newProfileName, setNewProfileName] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [showAdvancedPrompts, setShowAdvancedPrompts] = useState(false); 
  const [showMemorySystem, setShowMemorySystem] = useState(false);
  
  const [newPromptPresetName, setNewPromptPresetName] = useState("");
  const [isSavingPromptPreset, setIsSavingPromptPreset] = useState(false);

  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  const [isLoadingNotificationModels, setIsLoadingNotificationModels] = useState(false);
  const [availableNotificationModels, setAvailableNotificationModels] = useState<string[]>([]);
  const [notificationModelFetchError, setNotificationModelFetchError] = useState<string | null>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showNotificationModelDropdown, setShowNotificationModelDropdown] = useState(false);
  const [showDiagnosticsLog, setShowDiagnosticsLog] = useState(false);
  const [showAllDiagnostics, setShowAllDiagnostics] = useState(false);

  const clearNotificationOverrides = () => {
    setAiFormData(prev => ({
      ...prev,
      notificationProvider: undefined,
      notificationApiKey: undefined,
      notificationBaseUrl: undefined,
      notificationModelId: undefined,
    }));
    setAvailableNotificationModels([]);
    setNotificationModelFetchError(null);
    setShowNotificationModelDropdown(false);
  };

  useEffect(() => {
    setFormData(config);
  }, [config]);

  useEffect(() => {
    setAiFormData(aiConfig);
  }, [aiConfig]);

  useEffect(() => {
    setPromptsData(prompts); 
  }, [prompts]);

  useEffect(() => {
    if (aiFormData.provider === 'gemini') {
        const loadGeminiModels = async () => {
            const models = await GeminiService.fetchAvailableModels(aiFormData);
            setAvailableModels(models);
        };
        loadGeminiModels();
    } else {
        setAvailableModels([]);
    }
  }, [aiFormData.provider]);

  useEffect(() => {
    if (aiFormData.notificationProvider === 'gemini') {
        const loadGeminiModels = async () => {
            const notifConfig = {
                ...aiFormData,
                provider: 'gemini' as const,
                apiKey: aiFormData.notificationApiKey || aiFormData.apiKey,
                baseUrl: aiFormData.notificationBaseUrl || aiFormData.baseUrl
            };
            const models = await GeminiService.fetchAvailableModels(notifConfig);
            setAvailableNotificationModels(models);
        };
        loadGeminiModels();
    } else {
        setAvailableNotificationModels([]);
    }
  }, [aiFormData.notificationProvider]);

  const handleChange = (field: keyof PersonaConfig, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAiChange = (field: keyof AIConfig, value: any) => {
    setAiFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePromptChange = (field: keyof CustomPrompts, value: string) => {
    setPromptsData(prev => ({ ...prev, [field]: value }));
  };

  const handleApplyPromptPresetLocal = (presetPrompts: CustomPrompts) => {
      onApplyPromptPreset(presetPrompts);
      setPromptsData(JSON.parse(JSON.stringify(presetPrompts)));
  };

  const handleApplyProfile = (profile: ConnectionProfile) => {
    setAiFormData({
        provider: profile.provider,
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        modelId: profile.modelId,
        notificationProvider: profile.notificationProvider,
        notificationApiKey: profile.notificationProvider ? profile.notificationApiKey : undefined,
        notificationBaseUrl: profile.notificationProvider ? profile.notificationBaseUrl : undefined,
        notificationModelId: profile.notificationProvider ? profile.notificationModelId : undefined,
        enableStreaming: profile.enableStreaming ?? true
    });
  };

  const handleSaveProfile = () => {
    if (!newProfileName.trim()) return;
    onSaveConnectionProfile({ ...aiFormData, name: newProfileName });
    setNewProfileName("");
    setIsSavingProfile(false);
  };

  const handleSavePromptPreset = () => {
      if (!newPromptPresetName.trim()) return;
      onSavePromptPreset(newPromptPresetName, promptsData);
      setNewPromptPresetName("");
      setIsSavingPromptPreset(false);
  };

  const fetchModels = async () => {
      setIsLoadingModels(true);
      setModelFetchError(null);
      try {
          const models = await GeminiService.fetchAvailableModels(aiFormData);
          setAvailableModels(models);
          if (models.length > 0 && !models.includes(aiFormData.modelId)) {
              handleAiChange('modelId', models[0]);
          }
      } catch (e: any) {
          setModelFetchError(e.message || "Failed to fetch models");
          setAvailableModels([]);
      } finally {
          setIsLoadingModels(false);
      }
  };

  const fetchNotificationModels = async () => {
      setIsLoadingNotificationModels(true);
      setNotificationModelFetchError(null);
      try {
          const notifConfig = {
              ...aiFormData,
              provider: aiFormData.notificationProvider || aiFormData.provider,
              apiKey: aiFormData.notificationApiKey || aiFormData.apiKey,
              baseUrl: aiFormData.notificationBaseUrl || aiFormData.baseUrl
          };
          const models = await GeminiService.fetchAvailableModels(notifConfig);
          setAvailableNotificationModels(models);
          if (models.length > 0 && aiFormData.notificationModelId && !models.includes(aiFormData.notificationModelId)) {
              handleAiChange('notificationModelId', models[0]);
          } else if (models.length > 0 && !aiFormData.notificationModelId) {
              handleAiChange('notificationModelId', models[0]);
          }
      } catch (e: any) {
          setNotificationModelFetchError(e.message || "Failed to fetch models");
          setAvailableNotificationModels([]);
      } finally {
          setIsLoadingNotificationModels(false);
      }
  };

  useEffect(() => {
      if (aiFormData.provider === 'deepseek') {
          if (!aiFormData.baseUrl || aiFormData.baseUrl === 'https://api.openai.com/v1' || aiFormData.baseUrl === '') handleAiChange('baseUrl', 'https://api.deepseek.com');
          if (!aiFormData.modelId || aiFormData.modelId === 'gpt-4o-mini' || aiFormData.modelId === 'gemini-3-flash-preview') handleAiChange('modelId', 'deepseek-chat');
      } else if (aiFormData.provider === 'openai') {
          if (!aiFormData.baseUrl || aiFormData.baseUrl === 'https://api.deepseek.com' || aiFormData.baseUrl === '') handleAiChange('baseUrl', 'https://api.openai.com/v1');
          if (!aiFormData.modelId || aiFormData.modelId === 'deepseek-chat' || aiFormData.modelId === 'gemini-3-flash-preview') handleAiChange('modelId', 'gpt-4o-mini');
      } else if (aiFormData.provider === 'gemini') {
          handleAiChange('baseUrl', ''); 
          if (!aiFormData.modelId || aiFormData.modelId === 'deepseek-chat' || aiFormData.modelId === 'gpt-4o-mini') {
              handleAiChange('modelId', 'gemini-3-flash-preview');
          }
      }
  }, [aiFormData.provider]);

  useEffect(() => {
      if (aiFormData.notificationProvider === 'deepseek') {
          if (!aiFormData.notificationBaseUrl || aiFormData.notificationBaseUrl === 'https://api.openai.com/v1' || aiFormData.notificationBaseUrl === '') handleAiChange('notificationBaseUrl', 'https://api.deepseek.com');
          if (!aiFormData.notificationModelId || aiFormData.notificationModelId === 'gpt-4o-mini' || aiFormData.notificationModelId === 'gemini-3-flash-preview') handleAiChange('notificationModelId', 'deepseek-chat');
      } else if (aiFormData.notificationProvider === 'openai') {
          if (!aiFormData.notificationBaseUrl || aiFormData.notificationBaseUrl === 'https://api.deepseek.com' || aiFormData.notificationBaseUrl === '') handleAiChange('notificationBaseUrl', 'https://api.openai.com/v1');
          if (!aiFormData.notificationModelId || aiFormData.notificationModelId === 'deepseek-chat' || aiFormData.notificationModelId === 'gemini-3-flash-preview') handleAiChange('notificationModelId', 'gpt-4o-mini');
      } else if (aiFormData.notificationProvider === 'gemini') {
          handleAiChange('notificationBaseUrl', ''); 
          if (!aiFormData.notificationModelId || aiFormData.notificationModelId === 'deepseek-chat' || aiFormData.notificationModelId === 'gpt-4o-mini') {
              handleAiChange('notificationModelId', 'gemini-3-flash-preview');
          }
      }
  }, [aiFormData.notificationProvider]);

  const filteredDiagnosticsLogs = showAllDiagnostics
      ? diagnosticsLogs
      : diagnosticsLogs.filter(entry => getDiagnosticsChannel(entry) === 'content');

  const buildToggleTrackClass = (enabled: boolean, palette: 'pink' | 'cyan') =>
      `w-12 h-6 rounded-full transition-all duration-300 shrink-0 overflow-hidden p-1 flex items-center ${
          palette === 'pink'
              ? enabled
                  ? 'bg-pink-600 shadow-[0_0_10px_rgba(236,72,153,0.35)]'
                  : 'bg-gray-800 border border-gray-700'
              : enabled
                  ? 'bg-cyan-600 shadow-[0_0_10px_rgba(0,255,255,0.3)]'
                  : 'bg-gray-800 border border-gray-700'
      }`;

  const buildToggleThumbClass = (enabled: boolean) =>
      `h-4 w-4 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.35)] transition-transform duration-300 ${
          enabled ? 'translate-x-6' : 'translate-x-0'
      }`;

  const compactHelperTextClass = 'text-[10px] sm:text-xs text-gray-600 mt-1 leading-relaxed';
  const compactMetaTextClass = 'text-[10px] text-gray-500 font-mono';
  const compactActionButtonClass = 'px-2 py-1 text-[10px] border transition-colors';

  return (
    <div className="h-full flex flex-col p-4 space-y-6 overflow-y-auto pb-32">
      <div className="flex justify-between items-center border-b border-gray-800 pb-2">
        <h2 className="text-xl text-green-500 font-bold">SYSTEM_CONFIG</h2>
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-white">[RETURN]</button>
      </div>

      <div className="bg-[#111] border border-green-900/50 p-4 clip-corner-sm space-y-4">
          <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <h3 className="text-xs text-green-400 font-bold tracking-widest">NEURAL_LINK (AI 连接)</h3>
              </div>
              <button 
                onClick={() => setIsSavingProfile(!isSavingProfile)}
                className="text-[10px] text-green-600 hover:text-white border border-green-900 px-2 py-0.5 transition-colors"
              >
                {isSavingProfile ? 'CANCEL' : '+ SAVE CONFIG'}
              </button>
          </div>

          {isSavingProfile && (
              <div className="flex gap-2 animate-[fadeIn_0.2s] mb-2">
                  <input 
                    type="text" 
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="配置名称 (如: My DeepSeek)"
                    className="flex-1 bg-black border border-green-700 text-white text-xs p-2 outline-none focus:border-green-400"
                  />
                  <button onClick={handleSaveProfile} className="bg-green-700 text-white text-xs px-3 font-bold hover:bg-green-600">OK</button>
              </div>
          )}

          {savedConnectionProfiles.length > 0 && (
              <div className="flex flex-wrap gap-2 pb-2 border-b border-gray-800 mb-2">
                  {savedConnectionProfiles.map(profile => (
                      <div key={profile.id} className="flex items-center bg-gray-900 border border-gray-700 rounded-sm overflow-hidden group">
                          <button 
                            type="button"
                            onClick={() => handleApplyProfile(profile)}
                            className="px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-800 hover:text-green-400 border-r border-gray-700 transition-colors"
                          >
                              {profile.name}
                          </button>
                          <button 
                            type="button"
                            onClick={() => onDeleteConnectionProfile(profile.id)}
                            className="px-1.5 py-1 text-[10px] text-gray-600 hover:text-red-500 hover:bg-red-900/20"
                          >
                              ×
                          </button>
                      </div>
                  ))}
              </div>
          )}

          <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">Provider (服务商)</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(['gemini', 'deepseek', 'openai', 'custom'] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleAiChange('provider', p)}
                        className={`flex-1 py-2 text-xs border clip-corner-sm transition-all uppercase font-bold
                            ${aiFormData.provider === p 
                                ? 'bg-green-900/40 border-green-500 text-green-400 shadow-[0_0_10px_rgba(0,255,65,0.2)]' 
                                : 'bg-black border-gray-800 text-gray-600 hover:border-gray-600'}`}
                      >
                          {p}
                      </button>
                  ))}
              </div>
          </div>

          <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">API Key (密钥)</label>
              <input 
                  type="password"
                  value={aiFormData.apiKey}
                  onChange={(e) => handleAiChange('apiKey', e.target.value)}
                  placeholder={aiFormData.provider === 'gemini' ? "默认使用内置 Key (如有)" : "sk-..."}
                  className="w-full bg-black border border-gray-700 text-green-500 p-2 text-xs font-mono focus:border-green-500 outline-none placeholder-gray-800"
              />
          </div>

          {aiFormData.provider !== 'gemini' && (
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Base URL (API 代理地址)</label>
                <input 
                    type="text"
                    value={aiFormData.baseUrl}
                    onChange={(e) => handleAiChange('baseUrl', e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="w-full bg-black border border-gray-700 text-gray-300 p-2 text-xs font-mono focus:border-green-500 outline-none"
                />
                {aiFormData.provider === 'deepseek' && (
                    <div className="text-[10px] text-gray-500 mt-1 opacity-70">
                        DeepSeek 官方: <span className="text-gray-400">https://api.deepseek.com</span> (无需 /v1)
                    </div>
                )}
              </div>
          )}

          <div>
              <div className="flex justify-between items-end mb-1">
                  <label className="text-[10px] text-gray-500 uppercase">Model ID (模型名称)</label>
                  {aiFormData.provider !== 'gemini' && (
                    <button 
                        type="button"
                        onClick={fetchModels}
                        disabled={isLoadingModels || !aiFormData.apiKey}
                        className="text-[10px] text-green-600 hover:text-green-400 disabled:opacity-30 disabled:cursor-not-allowed border border-green-900/50 px-2 py-0.5 clip-corner-sm transition-all hover:bg-green-900/20"
                    >
                        {isLoadingModels ? '[SCANNING...]' : '[FETCH MODELS]'}
                    </button>
                  )}
              </div>
              
              <div className="relative">
                <input
                    type="text"
                    value={aiFormData.modelId}
                    onChange={(e) => handleAiChange('modelId', e.target.value)}
                    className="w-full bg-black border border-gray-700 text-white p-2 text-xs font-mono focus:border-green-500 outline-none pr-8 clip-corner-sm"
                    placeholder="输入或选择模型 ID"
                />
                <button
                    type="button"
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className="absolute right-0 top-0 h-full px-2 text-gray-500 hover:text-green-500 border-l border-gray-800 transition-colors"
                    disabled={availableModels.length === 0}
                >
                    ▼
                </button>
                
                {showModelDropdown && availableModels.length > 0 && (
                    <div className="absolute top-full left-0 w-full z-50 bg-[#111] border border-gray-700 max-h-[32vh] sm:max-h-40 overflow-y-auto shadow-lg clip-corner-sm mt-1">
                        {availableModels.map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => {
                                    handleAiChange('modelId', m);
                                    setShowModelDropdown(false);
                                }}
                                className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-green-900/30 hover:text-green-400 font-mono border-b border-gray-800 last:border-0"
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                )}
              </div>
              
              {modelFetchError && (
                  <div className="mt-2 p-2 bg-red-900/20 border border-red-800 text-[10px] text-red-400 font-mono break-all animate-[fadeIn_0.2s]">
                      ⚠ ERROR: {modelFetchError}
                  </div>
              )}
              
              {!isLoadingModels && !modelFetchError && availableModels.length > 0 && (
                  <div className="mt-1 text-[10px] text-gray-600 text-right">
                      Loaded {availableModels.length} models
                  </div>
              )}
          </div>

          <div className="mt-6 pt-4 border-t border-gray-800 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <h3 className="text-xs text-green-400 font-bold tracking-widest uppercase">NOTIFICATION_AI (后台通知专用)</h3>
              </div>
              <div className="text-[10px] text-gray-500 mb-3 opacity-80 leading-relaxed">
                  可独立配置后台提醒和主动关怀使用的模型（如使用更便宜的 DeepSeek），留空则默认使用上方主模型。
              </div>

              <div>
                  <label className="block text-[10px] text-gray-500 uppercase mb-1">Provider (服务商)</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <button
                          type="button"
                          onClick={clearNotificationOverrides}
                          className={`flex-1 py-2 text-[10px] border clip-corner-sm transition-all uppercase font-bold
                              ${!aiFormData.notificationProvider 
                                  ? 'bg-green-900/40 border-green-500 text-green-400 shadow-[0_0_10px_rgba(0,255,65,0.2)]' 
                                  : 'bg-black border-gray-800 text-gray-600 hover:border-gray-600'}`}
                      >
                          [同主模型]
                      </button>
                      {(['gemini', 'deepseek', 'openai', 'custom'] as const).map(p => (
                          <button
                              key={p}
                              type="button"
                              onClick={() => handleAiChange('notificationProvider', p)}
                              className={`flex-1 py-2 text-[10px] border clip-corner-sm transition-all uppercase font-bold
                                  ${aiFormData.notificationProvider === p 
                                      ? 'bg-green-900/40 border-green-500 text-green-400 shadow-[0_0_10px_rgba(0,255,65,0.2)]' 
                                      : 'bg-black border-gray-800 text-gray-600 hover:border-gray-600'}`}
                          >
                              {p}
                          </button>
                      ))}
                  </div>
              </div>

              {aiFormData.notificationProvider && (
                  <>
                      <div>
                          <label className="block text-[10px] text-gray-500 uppercase mb-1">API Key (密钥)</label>
                          <input 
                              type="password"
                              value={aiFormData.notificationApiKey || ''}
                              onChange={(e) => handleAiChange('notificationApiKey', e.target.value)}
                              placeholder={aiFormData.notificationProvider === 'gemini' ? "默认使用内置 Key (如有)" : "sk-..."}
                              className="w-full bg-black border border-gray-700 text-green-500 p-2 text-xs font-mono focus:border-green-500 outline-none placeholder-gray-800"
                          />
                      </div>

                      {aiFormData.notificationProvider !== 'gemini' && (
                          <div>
                              <label className="block text-[10px] text-gray-500 uppercase mb-1">Base URL (API 代理地址)</label>
                              <input 
                                  type="text"
                                  value={aiFormData.notificationBaseUrl || ''}
                                  onChange={(e) => handleAiChange('notificationBaseUrl', e.target.value)}
                                  placeholder="https://api.example.com/v1"
                                  className="w-full bg-black border border-gray-700 text-gray-300 p-2 text-xs font-mono focus:border-green-500 outline-none"
                              />
                              {aiFormData.notificationProvider === 'deepseek' && (
                                  <div className="text-[10px] text-gray-500 mt-1 opacity-70">
                                      DeepSeek 官方: <span className="text-gray-400">https://api.deepseek.com</span> (无需 /v1)
                                  </div>
                              )}
                          </div>
                      )}
                  </>
              )}

              <div>
                  <div className="flex justify-between items-end mb-1">
                      <label className="text-[10px] text-gray-500 uppercase">Model ID (模型名称)</label>
                      {aiFormData.notificationProvider && aiFormData.notificationProvider !== 'gemini' && (
                        <button 
                            type="button"
                            onClick={fetchNotificationModels}
                            disabled={isLoadingNotificationModels || (!aiFormData.notificationApiKey && !aiFormData.apiKey)}
                            className="text-[10px] text-green-600 hover:text-green-400 disabled:opacity-30 disabled:cursor-not-allowed border border-green-900/50 px-2 py-0.5 clip-corner-sm transition-all hover:bg-green-900/20"
                        >
                            {isLoadingNotificationModels ? '[SCANNING...]' : '[FETCH MODELS]'}
                        </button>
                      )}
                  </div>
                  
                  <div className="relative">
                    <input
                        type="text"
                        value={aiFormData.notificationModelId || ''}
                        onChange={(e) => handleAiChange('notificationModelId', e.target.value)}
                        className="w-full bg-black border border-gray-700 text-white p-2 text-xs font-mono focus:border-green-500 outline-none pr-8 clip-corner-sm"
                        placeholder={!aiFormData.notificationProvider ? "[与主模型一致]" : "输入或选择模型 ID"}
                    />
                    <button
                        type="button"
                        onClick={() => setShowNotificationModelDropdown(!showNotificationModelDropdown)}
                        className="absolute right-0 top-0 h-full px-2 text-gray-500 hover:text-green-500 border-l border-gray-800 transition-colors"
                        disabled={aiFormData.notificationProvider ? availableNotificationModels.length === 0 : availableModels.length === 0}
                    >
                        ▼
                    </button>

                    {showNotificationModelDropdown && (
                                    <div className="absolute top-full left-0 w-full z-50 bg-[#111] border border-gray-700 max-h-[32vh] sm:max-h-40 overflow-y-auto shadow-lg clip-corner-sm mt-1">
                            {!aiFormData.notificationProvider && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        handleAiChange('notificationModelId', ''); // Clear to use default
                                        setShowNotificationModelDropdown(false);
                                    }}
                                    className="w-full text-left px-2 py-1.5 text-xs text-gray-500 italic hover:bg-green-900/30 hover:text-green-400 font-mono border-b border-gray-800"
                                >
                                    [与主模型一致]
                                </button>
                            )}
                            
                            {(aiFormData.notificationProvider ? availableNotificationModels : availableModels).map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                        handleAiChange('notificationModelId', m);
                                        setShowNotificationModelDropdown(false);
                                    }}
                                    className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-green-900/30 hover:text-green-400 font-mono border-b border-gray-800 last:border-0"
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    )}
                  </div>

                  {notificationModelFetchError && (
                      <div className="mt-2 p-2 bg-red-900/20 border border-red-800 text-[10px] text-red-400 font-mono break-all animate-[fadeIn_0.2s]">
                          ⚠ ERROR: {notificationModelFetchError}
                      </div>
                  )}
                  
                  {!isLoadingNotificationModels && !notificationModelFetchError && availableNotificationModels.length > 0 && aiFormData.notificationProvider && (
                      <div className="mt-1 text-[10px] text-gray-600 text-right">
                          Loaded {availableNotificationModels.length} models
                      </div>
                  )}
              </div>
          </div>
      </div>
      
      <div className="bg-[#111] border border-cyan-900/50 clip-corner-sm p-3">
          <div className="flex items-start gap-3 sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                  <div className="text-xs text-pink-400 font-bold tracking-widest">HAPTIC_OUTPUT (震动反馈)</div>
                  <div className={compactHelperTextClass}>默认关闭。关闭后聊天、抽奖、通知等全部静音，仅保留专注结束提醒与 HAPTIC TEST。</div>
              </div>
              <button
                  type="button"
                  onClick={() => onUpdateAppPreferences({ hapticsEnabled: !appPreferences.hapticsEnabled })}
                  className={`${buildToggleTrackClass(appPreferences.hapticsEnabled, 'pink')} mt-1 sm:mt-0`}
              >
                  <div className={buildToggleThumbClass(appPreferences.hapticsEnabled)} />
              </button>
          </div>
      </div>

      <div className="bg-[#111] border border-cyan-900/50 clip-corner-sm p-3">
          <div className="flex items-start gap-3 sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                  <div className="text-xs text-cyan-400 font-bold tracking-widest">STREAMING_OUTPUT (流式输出)</div>
                  <div className={compactHelperTextClass}>实时逐字显示 AI 回复，而非等待完整响应。</div>
              </div>
              <button
                  type="button"
                  onClick={() => handleAiChange('enableStreaming', aiFormData.enableStreaming === false ? true : false)}
                  className={`${buildToggleTrackClass(aiFormData.enableStreaming !== false, 'cyan')} mt-1 sm:mt-0`}
              >
                  <div className={buildToggleThumbClass(aiFormData.enableStreaming !== false)} />
              </button>
          </div>
      </div>

      {showDiagnostics && (
          <div className="bg-[#111] border border-emerald-900/50 clip-corner-sm p-3 space-y-4">
              <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <div className="min-w-0">
                      <div className="text-xs text-emerald-400 font-bold tracking-widest">DIAGNOSTICS (真机链路诊断)</div>
                      <div className={compactHelperTextClass}>用于排查 Android 原生流桥和震动桥。Layout Preview 报错不算应用故障，以真机/模拟器实际运行结果为准。</div>
                  </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                      type="button"
                      disabled={isStreamProbeRunning || !aiFormData.apiKey}
                      onClick={() => onRunStreamProbe(aiFormData)}
                      className="py-2 text-xs border clip-corner-sm transition-all uppercase font-bold bg-black border-emerald-800 text-emerald-400 hover:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                      {isStreamProbeRunning ? 'STREAMING...' : 'STREAM PROBE'}
                  </button>
                  <button
                      type="button"
                      disabled={isHapticProbeRunning}
                      onClick={onRunHapticTest}
                      className="py-2 text-xs border clip-corner-sm transition-all uppercase font-bold bg-black border-emerald-800 text-emerald-400 hover:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                      {isHapticProbeRunning ? 'VIBRATING...' : 'HAPTIC TEST'}
                  </button>
              </div>

              <div className="bg-black/50 border border-gray-800 p-2 clip-corner-sm space-y-2 text-[10px] font-mono">
                  <div className="text-emerald-400 font-bold">LATEST SNAPSHOT</div>
                  <div className="text-gray-400">stream: <span className="text-gray-200">{streamDiagnostics.transport}</span> / chunks <span className="text-gray-200">{streamDiagnostics.chunkCount}</span> / first-chunk <span className="text-gray-200">{streamDiagnostics.firstChunkMs ?? '-'} ms</span></div>
                  <div className="text-gray-400">haptic: <span className="text-gray-200">{appPreferences.hapticsEnabled ? 'ON' : 'OFF'}</span> / backend <span className="text-gray-200">{hapticDiagnostics.lastBackend || 'unknown'}</span> / emotion <span className="text-gray-200">{hapticDiagnostics.lastEmotion || '-'}</span> / bridge <span className="text-gray-200">{hapticDiagnostics.nativeStatus?.bridgeReady ? 'READY' : 'MISSING'}</span></div>
              </div>

              <div className="bg-black/50 border border-gray-800 clip-corner-sm">
                  <button
                      type="button"
                      onClick={() => setShowDiagnosticsLog(prev => !prev)}
                      className="w-full p-3 flex justify-between items-center text-[10px] text-emerald-400 font-bold tracking-widest hover:bg-emerald-900/10 transition-colors"
                  >
                      <span>DIAGNOSTICS LOG ({filteredDiagnosticsLogs.length})</span>
                      <span>{showDiagnosticsLog ? '[-]' : '[+]'}</span>
                  </button>

                  {showDiagnosticsLog && (
                      <div className="border-t border-gray-800 p-2 space-y-2 max-h-[50vh] sm:max-h-80 overflow-y-auto custom-scrollbar animate-[fadeIn_0.2s]">
                            <div className="flex flex-col gap-2 pb-2 border-b border-gray-800 sm:flex-row sm:items-center sm:justify-between">
                                <div className={compactMetaTextClass}>
                                    {showAllDiagnostics ? 'ALL EVENTS' : 'CONTENT ONLY'} / total {diagnosticsLogs.length}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={onClearDiagnosticsLogs}
                                        className={`${compactActionButtonClass} border-red-900/50 text-red-300 hover:border-red-500 hover:text-red-200`}
                                    >
                                        CLEAR LOGS
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowAllDiagnostics(prev => !prev)}
                                        className={`${compactActionButtonClass} border-emerald-900/50 text-emerald-300 hover:border-emerald-500 hover:text-emerald-200`}
                                    >
                                        {showAllDiagnostics ? 'SHOW CONTENT ONLY' : 'SHOW ALL EVENTS'}
                                    </button>
                                </div>
                            </div>

                          {filteredDiagnosticsLogs.length === 0 ? (
                              <div className="text-[10px] text-gray-600 font-mono p-2 border border-dashed border-gray-800">NO_DIAGNOSTIC_ENTRIES_YET</div>
                          ) : filteredDiagnosticsLogs.slice(0, 60).map(entry => {
                              const statusColor = entry.status === 'error'
                                  ? 'text-red-400 border-red-900/50'
                                  : entry.status === 'fallback'
                                      ? 'text-yellow-400 border-yellow-900/50'
                                      : entry.status === 'skipped'
                                          ? 'text-gray-400 border-gray-700'
                                          : 'text-emerald-400 border-emerald-900/50';

                              return (
                                  <div key={entry.id} className="bg-[#090909] border border-gray-800 p-2 clip-corner-sm text-[10px] font-mono space-y-1">
                                      <div className="flex items-center justify-between gap-2">
                                          <div className="text-gray-500">{new Date(entry.timestamp).toLocaleString('zh-CN', { hour12: false })}</div>
                                          <div className={`px-2 py-0.5 border ${statusColor}`}>{entry.status.toUpperCase()}</div>
                                      </div>
                                      <div className="flex flex-wrap gap-2 text-[10px]">
                                          <span className="text-cyan-400">[{entry.domain}]</span>
                                          <span className={getDiagnosticsChannel(entry) === 'content' ? 'text-emerald-500' : 'text-gray-500'}>
                                              {getDiagnosticsChannel(entry)}
                                          </span>
                                          <span className="text-emerald-300">{entry.source}</span>
                                          {typeof entry.attempt === 'number' && <span className="text-yellow-400">attempt #{entry.attempt}</span>}
                                          {entry.reason && <span className="text-orange-300">reason: {entry.reason}</span>}
                                          {entry.backend && <span className="text-gray-400">backend: {entry.backend}</span>}
                                          {entry.resolvedEmotion && <span className="text-pink-400">emotion: {entry.resolvedEmotion}</span>}
                                          {!entry.resolvedEmotion && entry.emotion && <span className="text-pink-400">emotion: {entry.emotion}</span>}
                                          {entry.rawEmotion && entry.rawEmotion !== entry.resolvedEmotion && (
                                              <span className="text-fuchsia-300">raw: {entry.rawEmotion}</span>
                                          )}
                                          {typeof entry.markerDetected === 'boolean' && <span className="text-gray-500">marker: {entry.markerDetected ? 'YES' : 'NO'}</span>}
                                      </div>
                                      <div className="text-gray-200 whitespace-pre-wrap break-words">{entry.message}</div>
                                      {entry.details && <div className="text-gray-500 whitespace-pre-wrap break-words">{entry.details}</div>}
                                  </div>
                              );
                          })}
                      </div>
                  )}
              </div>
          </div>
      )}

      <div className="bg-[#111] border border-orange-900/50 clip-corner-sm">
           <button
              type="button"
              onClick={() => setShowAdvancedPrompts(!showAdvancedPrompts)}
              className="w-full p-3 flex justify-between items-center text-xs text-orange-400 font-bold tracking-widest hover:bg-orange-900/10 transition-colors"
           >
              <span>PROMPT_OVERRIDE (指令覆写)</span>
              <span>{showAdvancedPrompts ? '[-]' : '[+]'}</span>
           </button>
           
           {showAdvancedPrompts && (
               <div className="p-3 border-t border-orange-900/30 space-y-4 animate-[fadeIn_0.2s]">
                   
                   <div className="bg-[#1a1105] border border-orange-900/30 p-2 rounded-sm mb-4">
                       <div className="flex justify-between items-center mb-2">
                           <label className="text-[10px] text-orange-500 font-bold">SAVED PROMPT PRESETS</label>
                           <button 
                               type="button"
                               onClick={() => setIsSavingPromptPreset(!isSavingPromptPreset)}
                               className="text-[10px] text-orange-400 hover:text-white border border-orange-800 px-2 py-0.5"
                           >
                               {isSavingPromptPreset ? 'CANCEL' : '+ SAVE CURRENT AS PRESET'}
                           </button>
                       </div>

                       {isSavingPromptPreset && (
                           <div className="flex gap-2 animate-[fadeIn_0.2s] mb-2">
                               <input 
                                   type="text" 
                                   value={newPromptPresetName}
                                   onChange={(e) => setNewPromptPresetName(e.target.value)}
                                   placeholder="预设名称 (如: 毒舌模式)"
                                   className="flex-1 bg-black border border-orange-700 text-white text-xs p-2 outline-none focus:border-orange-400"
                               />
                               <button type="button" onClick={handleSavePromptPreset} className="bg-orange-700 text-white text-xs px-3 font-bold hover:bg-orange-600">OK</button>
                           </div>
                       )}

                       <div className="flex flex-wrap gap-2">
                           {GeminiService.BUILTIN_PROMPT_PRESETS.map((preset) => (
                               <button 
                                   key={preset.id}
                                   type="button"
                                   onClick={() => handleApplyPromptPresetLocal(preset.prompts)}
                                   className="px-2 py-1 text-[10px] bg-orange-900/20 text-orange-300 border border-orange-700/50 hover:bg-orange-600 hover:text-black hover:border-orange-500 transition-all clip-corner-sm shadow-[0_0_5px_rgba(255,165,0,0.1)]"
                                   title="系统内置预设"
                               >
                                   {preset.name}
                               </button>
                           ))}
                           
                           {savedPromptPresets.length > 0 && <div className="w-px bg-orange-900/50 mx-1"></div>}

                           {savedPromptPresets.map((preset) => (
                               <div key={preset.id} className="flex items-center bg-gray-900 border border-gray-700 rounded-sm overflow-hidden group">
                                   <button 
                                       type="button"
                                       onClick={() => handleApplyPromptPresetLocal(preset.prompts)}
                                       className="px-2 py-1 text-[10px] text-gray-300 hover:bg-orange-900/20 hover:text-orange-400 border-r border-gray-700 transition-colors"
                                   >
                                       {preset.name}
                                   </button>
                                   <button 
                                       type="button"
                                       onClick={() => onDeletePromptPreset(preset.id)}
                                       className="px-1.5 py-1 text-[10px] text-gray-600 hover:text-red-500 hover:bg-red-900/20"
                                   >
                                       ×
                                   </button>
                               </div>
                           ))}
                       </div>
                   </div>

                   <div className="text-[10px] text-orange-700 bg-orange-900/10 p-2 border border-orange-900/30 mb-2">
                       ⚠ WARNING: 修改核心指令可能导致 AI 行为异常或崩坏。支持使用 &#123;variable&#125; 占位符。
                       <br/>如需恢复，请点击上方的 <b>终端默认 (Default)</b> 按钮。
                   </div>
                   
                   <div className="space-y-4">
                       {[
                           { key: 'system', label: 'SYSTEM PROMPT (核心人设)', desc: '变量: {name}, {description}, {worldLore}, {voiceTone}, {userRole}, {currentGoal}' },
                           { key: 'journal', label: 'JOURNAL ANALYSIS (日志分析)', desc: '变量: {content}' },
                           { key: 'summarize', label: 'MEMORY ARCHIVE (记忆归档)', desc: '变量: {timestamp}, {selectedText}, {name}' },
                           { key: 'food', label: 'FOOD ANALYSIS (食物分析)', desc: '变量: {foodContent}' },
                           { key: 'sleep', label: 'SLEEP REPORT (晨间报告)', desc: '变量: {sleepDuration}, {wakeUpFeeling}, {previousDayLogs}...' },
                           { key: 'gacha', label: 'GACHA TEXT (抽奖文案)', desc: '变量: {item}, {name}' },
                           { key: 'focus', label: 'FOCUS FAIL (专注嘲讽)', desc: '变量: {reason}' },
                            { key: 'focusSuccess', label: 'FOCUS SUCCESS (专注鼓励)', desc: '变量: {duration}' },
                            { key: 'overseer', label: 'OVERSEER (主脑指令)', desc: '变量: {name}。定义主脑的全局视野和权限意识。' },
                           { key: 'notification', label: 'NOTIFICATIONS (通知)', desc: '变量: {context}。仅控制通知的语气/文案内容，不控制触发时间（触发由健康协议决定）。' }
                       ].map(({ key, label, desc }) => (
                           <div key={key}>
                               <div className="flex flex-col gap-1 mb-1 sm:flex-row sm:items-start sm:justify-between">
                                   <label className="text-[10px] text-orange-500 font-bold">{label}</label>
                                   <span className="text-[10px] text-gray-600 font-mono sm:flex-1 sm:ml-2 sm:text-right">{desc}</span>
                               </div>
                               <textarea
                                   value={(promptsData as any)[key as keyof CustomPrompts]}
                                   onChange={(e) => handlePromptChange(key as keyof CustomPrompts, e.target.value)}
                                   className="w-full h-32 bg-black border border-gray-700 text-gray-300 p-2 text-xs font-mono focus:border-orange-500 outline-none resize-y placeholder-gray-800"
                                   spellCheck={false}
                               />
                           </div>
                       ))}
                   </div>
               </div>
           )}
      </div>

      <div className="bg-[#111] p-3 border border-purple-900/50 clip-corner-sm space-y-3">
            <label className="block text-xs text-purple-400 mb-2 font-bold tracking-widest">USER_PROFILE (用户档案)</label>
            <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Current Role (身份)</label>
                <input
                    type="text"
                    value={formData.userRole || ""}
                    onChange={(e) => handleChange('userRole', e.target.value)}
                    placeholder="例如：计算机专业研究生 / 自由设计师"
                    className="w-full bg-[#050505] border border-gray-700 p-2 text-sm text-white focus:border-purple-500 outline-none placeholder-gray-800"
                />
            </div>
            <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Prime Directive (核心目标)</label>
                <input
                    type="text"
                    value={formData.currentGoal || ""}
                    onChange={(e) => handleChange('currentGoal', e.target.value)}
                    placeholder="例如：完成毕业论文 / 30天减脂"
                    className="w-full bg-[#050505] border border-gray-700 p-2 text-sm text-white focus:border-purple-500 outline-none placeholder-gray-800"
                />
            </div>
            <p className="text-[10px] text-gray-600 mt-1">
                * 这些信息将动态注入 AI 的系统指令中，使其更懂你的处境。
            </p>
      </div>

      <div className="bg-gray-900/20 border border-gray-700/50 clip-corner-sm">
           <button 
              type="button"
              onClick={() => setShowMemorySystem(!showMemorySystem)}
              className="w-full p-3 flex justify-between items-center text-xs text-gray-300 font-bold tracking-widest hover:bg-gray-800/30 transition-colors"
           >
              <span>MEMORY_SYSTEM (记忆系统)</span>
              <span>{showMemorySystem ? '[-]' : '[+]'}</span>
           </button>
           
           {showMemorySystem && (
               <div className="p-3 pt-0 space-y-4 animate-[fadeIn_0.2s] border-t border-gray-800/50 mt-1">
                   <div>
                       <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                           <span className="uppercase">Global Recall Limit (长期记忆)</span>
                           <span className="text-gray-300 font-mono">{formData.memoryRecallLimit ?? 20} ITEMS</span>
                       </div>
                       <input
                            type="range"
                            min="0"
                            max="50"
                            step="5"
                            value={formData.memoryRecallLimit ?? 20}
                            onChange={(e) => handleChange('memoryRecallLimit', parseInt(e.target.value))}
                            className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-gray-500"
                       />
                       <div className="text-[10px] text-gray-600 mt-1">
                           {(formData.memoryRecallLimit ?? 20) === 0 ? (
                               <span className="text-yellow-500">⚠ 全部读取 (消耗大，需模型支持高并发)</span>
                           ) : (
                               `读取最新的 ${formData.memoryRecallLimit ?? 20} 条全局记忆归档`
                           )}
                       </div>
                   </div>

                   <div>
                       <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                           <span className="uppercase">Recent Log Context (近期日志)</span>
                           <span className="text-gray-300 font-mono">{formData.journalRecallLimit ?? 3} ITEMS</span>
                       </div>
                       <input
                            type="range"
                            min="0"
                            max="200"
                            step="10"
                            value={formData.journalRecallLimit ?? 3}
                            onChange={(e) => handleChange('journalRecallLimit', parseInt(e.target.value))}
                            className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-gray-500"
                       />
                       <div className="text-[10px] text-gray-600 mt-1">
                           {(formData.journalRecallLimit ?? 3) === 0 ? (
                               <span className="text-yellow-500">⚠ 全部读取 (消耗极大，可能超出上下文限制)</span>
                           ) : (
                               `读取最新的 ${formData.journalRecallLimit ?? 3} 条 Dashboard 日志作为即时上下文`
                           )}
                       </div>
                   </div>

                   <div>
                       <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                           <span className="uppercase">Archive Recall Limit (聊天档案)</span>
                           <span className="text-gray-300 font-mono">{formData.archiveRecallLimit ?? 50} ITEMS</span>
                       </div>
                       <input
                            type="range"
                            min="0"
                            max="200"
                            step="10"
                            value={formData.archiveRecallLimit ?? 50}
                            onChange={(e) => handleChange('archiveRecallLimit', parseInt(e.target.value))}
                            className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-gray-500"
                       />
                       <div className="text-[10px] text-gray-600 mt-1">
                           {(formData.archiveRecallLimit ?? 50) === 0 ? (
                               <span className="text-yellow-500">⚠ 全部读取 (可能导致上下文溢出或分析失败)</span>
                           ) : (
                               `读取最新的 ${formData.archiveRecallLimit ?? 50} 条聊天记录作为分析素材`
                           )}
                       </div>
                   </div>
               </div>
           )}
      </div>

      <div className="bg-[#1a1100] p-3 border border-yellow-800/50 clip-corner-sm space-y-3">
            <div className="flex justify-between items-center">
                <label className="text-xs text-yellow-400 font-bold tracking-widest">DATA_ARCHIVE (数据管理)</label>
            </div>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onExportData}
                    className="flex-1 text-center py-2 text-xs border clip-corner-sm transition-all uppercase font-bold bg-black border-yellow-800 text-yellow-600 hover:border-yellow-500 hover:text-yellow-400"
                >
                    EXPORT DATA
                </button>
                <label className="flex-1 text-center py-2 text-xs border clip-corner-sm transition-all uppercase font-bold bg-black border-yellow-800 text-yellow-600 hover:border-yellow-500 hover:text-yellow-400 cursor-pointer">
                    IMPORT DATA
                    <input type="file" accept=".json" className="hidden" onChange={onImportData} />
                </label>
            </div>
            <p className="text-[10px] text-gray-600 text-center mt-1">
                导出全部日志、设置和统计数据。导入将覆盖当前所有数据。
            </p>
        </div>
      
      <div className="bg-[#0a0a0a] p-3 border border-gray-800 clip-corner-sm space-y-2">
            <div className="flex justify-between items-center">
                <label className="text-xs text-gray-400 font-bold">SAVED_PERSONAS (已存人设)</label>
                <button 
                    type="button"
                    onClick={() => onSaveAsPreset(formData)}
                    className="text-[10px] bg-green-900/30 text-green-400 px-2 py-1 border border-green-800 hover:bg-green-800 hover:text-white transition-colors"
                >
                    + SAVE CURRENT
                </button>
            </div>
            
            <div className="flex flex-wrap gap-2">
                {savedPresets.length === 0 && <span className="text-[10px] text-gray-600 italic">暂无自定义预设...</span>}
                {savedPresets.map((preset, idx) => (
                    <div key={idx} className="flex items-center bg-gray-900 border border-gray-700 px-2 py-1 rounded-sm group hover:border-green-500/50 transition-colors">
                        <button 
                            type="button"
                            onClick={() => onApplyPreset(preset)}
                            className="text-[10px] text-gray-300 group-hover:text-green-300 mr-2"
                        >
                            {preset.name.length > 10 ? preset.name.slice(0, 10) + '...' : preset.name}
                        </button>
                        <button 
                            type="button"
                            onClick={() => onDeletePreset(idx)}
                            className="text-gray-600 hover:text-red-500 text-[10px]"
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
        </div>

        <div className="bg-blue-900/10 p-3 border border-blue-900/30 clip-corner-sm space-y-4">
           <label className="block text-xs text-blue-400 mb-2 font-bold tracking-widest">HEALTH_PROTOCOLS (健康协议)</label>
           
           <div>
               <div className="text-[10px] text-gray-500 uppercase mb-2">Sleep Cycle (睡眠周期)</div>
               <div className="flex items-center gap-3">
                   <div className="flex flex-col gap-1">
                       <span className="text-[10px] text-gray-500">START (入睡)</span>
                       <input
                        type="time"
                        value={formData.targetSleepTime || "23:00"}
                        onChange={(e) => handleChange('targetSleepTime', e.target.value)}
                        className="bg-[#050505] border border-gray-700 text-white p-2 text-lg font-mono focus:border-blue-500 outline-none w-28 text-center"
                       />
                   </div>
                   <span className="text-gray-600 mt-4">➜</span>
                   <div className="flex flex-col gap-1">
                       <span className="text-[10px] text-gray-500">END (唤醒)</span>
                       <input
                        type="time"
                        value={formData.wakeUpTime || "07:00"}
                        onChange={(e) => handleChange('wakeUpTime', e.target.value)}
                        className="bg-[#050505] border border-gray-700 text-white p-2 text-lg font-mono focus:border-blue-500 outline-none w-28 text-center"
                       />
                   </div>
               </div>
           </div>

           <div className="border-t border-blue-900/30 pt-4">
               <div className="text-[10px] text-gray-500 uppercase mb-2">Hydration Protocol (喝水提醒)</div>
               <div className="space-y-3">
                   <div className="flex gap-2">
                       {(['SMART', 'INTERVAL', 'OFF'] as const).map(mode => (
                           <button
                             key={mode}
                             type="button"
                             onClick={() => handleChange('waterReminderMode', mode)}
                             className={`flex-1 py-2 text-[10px] border clip-corner-sm transition-all uppercase font-bold
                                ${formData.waterReminderMode === mode 
                                    ? 'bg-cyan-900/40 border-cyan-500 text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]' 
                                    : 'bg-black border-gray-800 text-gray-600 hover:border-gray-600'}`}
                           >
                               {mode === 'SMART' ? 'Smart (节律)' : mode === 'INTERVAL' ? 'Loop (循环)' : 'OFF'}
                           </button>
                       ))}
                   </div>
                   
                   {formData.waterReminderMode === 'SMART' && (
                       <div className="text-[10px] text-cyan-700 bg-cyan-900/10 p-2 border border-cyan-900/30">
                           ℹ 系统将基于您的【作息时间】自动计算最佳补水锚点（如晨起、餐前、下午茶时间）。
                       </div>
                   )}

                   {formData.waterReminderMode === 'INTERVAL' && (
                       <div className="animate-[fadeIn_0.2s]">
                           <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                               <span>REMINDER INTERVAL</span>
                               <span className="text-cyan-400">{formData.waterReminderInterval || 45} MIN</span>
                           </div>
                           <input
                                type="range"
                                min="30"
                                max="120"
                                step="5"
                                value={formData.waterReminderInterval || 45}
                                onChange={(e) => handleChange('waterReminderInterval', parseInt(e.target.value))}
                                className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                           />
                       </div>
                   )}
               </div>
           </div>
        </div>

        <div className="space-y-4">
            <div className="border-t border-gray-800 pt-4">
            <label className="block text-xs text-gray-400 mb-1">CORE_PERSONA (AI 核心人设)</label>
            <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full bg-[#111] border border-gray-700 p-2 text-sm text-white focus:border-green-500 outline-none placeholder-gray-800"
                placeholder="例如: 傲娇的猫娘助手"
            />
            </div>
            
            <div>
            <label className="block text-xs text-gray-400 mb-1">VOICE_MODULE (语气设定)</label>
            <input
                type="text"
                value={formData.voiceTone}
                onChange={(e) => handleChange('voiceTone', e.target.value)}
                className="w-full bg-[#111] border border-gray-700 p-2 text-sm text-white focus:border-green-500 outline-none"
            />
            </div>

            <div>
            <label className="block text-xs text-gray-400 mb-1">WORLD_LORE (用户背景)</label>
            <textarea
                value={formData.worldLore}
                onChange={(e) => handleChange('worldLore', e.target.value)}
                className="w-full h-20 bg-[#111] border border-gray-700 p-2 text-sm text-white focus:border-green-500 outline-none resize-none"
            />
            </div>

            <div>
            <label className="block text-xs text-gray-400 mb-1">DESCRIPTION (详细描述)</label>
            <textarea
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                className="w-full h-24 bg-[#111] border border-gray-700 p-2 text-sm text-white focus:border-green-500 outline-none resize-none"
            />
            </div>
        </div>

      <button
        type="button"
        onClick={() => onSave(formData, aiFormData, promptsData)}
        className="mt-6 py-3 bg-green-900/50 border border-green-500 text-green-400 hover:bg-green-500 hover:text-black font-bold transition w-full clip-corner"
      >
        APPLY & SAVE CONFIG
      </button>
    </div>
  );
};
