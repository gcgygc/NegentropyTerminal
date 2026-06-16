
import React, { useState, useEffect } from 'react';
import { LifeLog, LifeEventType, PersonaConfig, FoodAnalysisResponse } from '../types';
import MarkdownText from './MarkdownText';
import { RotateCcw, AlertTriangle, CalendarHeart, Zap } from 'lucide-react';

interface BioMonitorProps {
  logs: LifeLog[];
  onRecord: (type: LifeEventType, content?: string) => void;
  persona: PersonaConfig;
  isAnalyzing?: boolean; 
  analysisResult: FoodAnalysisResponse | null; 
  onCloseAnalysis: () => void;
  onWakeUp: () => void;
  isSleeping: boolean;
  onRetry: (log: LifeLog) => void;
  onNavigateToCycleTracker: () => void; // New prop for navigation
  
  // Lifted Navigation Props
  selectedLog: LifeLog | null;
  onSelectLog: (log: LifeLog) => void;
  onCloseLogDetail: () => void;
  
  isFoodInputOpen: boolean;
  onOpenFoodInput: () => void;
  onCloseFoodInput: () => void;
}

const BioMonitor: React.FC<BioMonitorProps> = ({ 
    logs, onRecord, persona, isAnalyzing = false, analysisResult, onCloseAnalysis, onWakeUp, isSleeping, onRetry, onNavigateToCycleTracker,
    selectedLog, onSelectLog, onCloseLogDetail,
    isFoodInputOpen, onOpenFoodInput, onCloseFoodInput
}) => {
  const [now, setNow] = useState(Date.now());
  const [foodContent, setFoodContent] = useState('');
  const [isNapInputOpen, setIsNapInputOpen] = useState(false);
  const [napDuration, setNapDuration] = useState(20);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000); 
    return () => clearInterval(timer);
  }, []);

  const handleActionClick = (type: LifeEventType) => {
    if (type === 'MEAL') onOpenFoodInput();
    else if (type === 'NAP') setIsNapInputOpen(true);
    else if (type === 'SLEEP') {
        if (isSleeping) onWakeUp();
        else onRecord('SLEEP');
    } else {
        onRecord(type);
    }
  };

  const submitFood = (e: React.FormEvent) => {
    e.preventDefault();
    if (!foodContent.trim() || isAnalyzing) return;
    onRecord('MEAL', foodContent);
    onCloseFoodInput();
    setFoodContent('');
  };

  const submitNap = () => {
      onRecord('NAP', `Quick Nap: ${napDuration} mins`);
      setIsNapInputOpen(false);
  };

  const handleLogClick = (log: LifeLog) => {
      if (log.status === 'FAILED' || log.aiAnalysis || log.description || typeof log.value === 'number') {
          onSelectLog(log);
      }
  };

  const formatLogValue = (log: LifeLog) => {
    if (typeof log.value !== 'number') return null;
    if (log.type === 'EXERCISE') return `${log.value} min`;
    return `${log.value}`;
  };

  const analyzeTiming = (type: LifeEventType, timestamp: number): { status: string, color: string } => {
    const hours = new Date(timestamp).getHours();
    if (type === 'MEAL') {
        if (hours >= 6 && hours <= 9) return { status: 'BREAKFAST', color: 'text-yellow-400' };
        if (hours >= 11 && hours <= 14) return { status: 'LUNCH', color: 'text-yellow-400' };
        if (hours >= 17 && hours <= 20) return { status: 'DINNER', color: 'text-yellow-400' };
        if (hours >= 21 || hours < 5) return { status: 'LATE_NIGHT', color: 'text-red-400' };
        return { status: 'SNACK', color: 'text-gray-400' };
    }
    if (type === 'SLEEP') {
        const [targetH] = persona.targetSleepTime.split(':').map(Number);
        let diff = hours - targetH;
        if (diff < -12) diff += 24; 
        if (Math.abs(diff) <= 1) return { status: 'ON_TIME', color: 'text-purple-400' };
        return { status: 'DELAYED', color: 'text-red-400' };
    }
    if (type === 'WAKE_UP') return { status: 'AWAKE', color: 'text-green-400' };
    if (type === 'EXERCISE') return { status: 'ACTIVE', color: 'text-orange-400' };
    if (type === 'NAP') return { status: 'RESTED', color: 'text-blue-400' };
    return { status: 'LOGGED', color: 'text-cyan-400' };
  };

  const getLastTimeStr = (type: LifeEventType) => {
    const allLogsOfType = logs.filter(log => log.type === type && log.status !== 'FAILED');
    if (allLogsOfType.length === 0) return "NO_RECORD";
    const lastLog = allLogsOfType.sort((a,b) => b.timestamp - a.timestamp)[0];
    const diffMins = Math.floor((now - lastLog.timestamp) / 60000);
    if (diffMins < 60) return `${diffMins}m AGO`;
    return `${Math.floor(diffMins / 60)}h AGO`;
  };

  const DailyTimeline = () => (
    <div className="relative w-full h-12 bg-[#111] border border-gray-800 rounded mb-6 overflow-hidden mt-2 shrink-0">
      <div className="absolute inset-0 flex justify-between px-2 pointer-events-none">{[0, 6, 12, 18, 24].map(h => <div key={h} className="h-full border-l border-gray-800 text-[10px] text-gray-600 pt-8 relative"><span className="absolute -left-1 top-8">{h}</span></div>)}</div>
      <div className="absolute top-0 bottom-0 w-0.5 bg-green-500/50 z-10" style={{ left: `${(new Date().getHours() * 60 + new Date().getMinutes()) / 1440 * 100}%` }}></div>
      {logs.map(log => {
        const date = new Date(log.timestamp), pct = (date.getHours() * 60 + date.getMinutes()) / 1440 * 100;
        let color = 'bg-gray-500';
        if (log.status === 'FAILED') color = 'bg-red-500 animate-pulse';
        else if (log.status === 'PENDING') color = 'bg-gray-500 animate-pulse';
        else if (log.type === 'WATER') color = 'bg-cyan-500';
        else if (log.type === 'MEAL') color = 'bg-yellow-500';
        else if (log.type === 'SLEEP') color = 'bg-purple-500';
        else if (log.type === 'WAKE_UP') color = 'bg-green-500';
        else if (log.type === 'EXERCISE') color = 'bg-orange-500';
        else if (log.type === 'NAP') color = 'bg-blue-500';
        return <button key={log.id} onClick={() => handleLogClick(log)} className={`absolute top-2 w-1.5 h-4 rounded-sm ${color} hover:scale-150 transition-transform cursor-pointer z-20`} style={{ left: `${pct}%` }} title={`${new Date(log.timestamp).toLocaleTimeString()} - ${log.type} ${log.status === 'FAILED' ? '(FAILED)' : ''}`}></button>;
      })}
    </div>
  );

  const actionPalette = {
    cyan: {
      hoverBorder: 'hover:border-cyan-500',
      bg: 'bg-cyan-900/10',
      hoverBg: 'hover:bg-cyan-900/20',
      iconBorder: 'border-cyan-500/30',
      iconText: 'text-cyan-500',
      titleText: 'text-cyan-500',
      countText: 'text-cyan-400',
      shimmer: 'via-cyan-500/10',
    },
    yellow: {
      hoverBorder: 'hover:border-yellow-500',
      bg: 'bg-yellow-900/10',
      hoverBg: 'hover:bg-yellow-900/20',
      iconBorder: 'border-yellow-500/30',
      iconText: 'text-yellow-500',
      titleText: 'text-yellow-500',
      countText: 'text-yellow-400',
      shimmer: 'via-yellow-500/10',
    },
    blue: {
      hoverBorder: 'hover:border-blue-500',
      bg: 'bg-blue-900/10',
      hoverBg: 'hover:bg-blue-900/20',
      iconBorder: 'border-blue-500/30',
      iconText: 'text-blue-500',
      titleText: 'text-blue-500',
      countText: 'text-blue-400',
      shimmer: 'via-blue-500/10',
    },
    pink: {
      hoverBorder: 'hover:border-pink-500',
      bg: 'bg-pink-900/10',
      hoverBg: 'hover:bg-pink-900/20',
      iconBorder: 'border-pink-500/30',
      iconText: 'text-pink-400',
      titleText: 'text-pink-400',
      countText: 'text-pink-300',
      shimmer: 'via-pink-500/10',
    },
    emerald: {
      hoverBorder: 'hover:border-emerald-500',
      bg: 'bg-emerald-900/10',
      hoverBg: 'hover:bg-emerald-900/20',
      iconBorder: 'border-emerald-500/30',
      iconText: 'text-emerald-400',
      titleText: 'text-emerald-400',
      countText: 'text-emerald-300',
      shimmer: 'via-emerald-500/10',
    },
    orange: {
      hoverBorder: 'hover:border-orange-500',
      bg: 'bg-orange-900/10',
      hoverBg: 'hover:bg-orange-900/20',
      iconBorder: 'border-orange-500/30',
      iconText: 'text-orange-500',
      titleText: 'text-orange-500',
      countText: 'text-orange-400',
      shimmer: 'via-orange-500/10',
    },
    green: {
      hoverBorder: 'hover:border-green-500',
      bg: 'bg-green-900/10',
      hoverBg: 'hover:bg-green-900/20',
      iconBorder: 'border-green-500/30',
      iconText: 'text-green-500',
      titleText: 'text-green-500',
      countText: 'text-green-400',
      shimmer: 'via-green-500/10',
    },
    purple: {
      hoverBorder: 'hover:border-purple-500',
      bg: 'bg-purple-900/10',
      hoverBg: 'hover:bg-purple-900/20',
      iconBorder: 'border-purple-500/30',
      iconText: 'text-purple-500',
      titleText: 'text-purple-500',
      countText: 'text-purple-400',
      shimmer: 'via-purple-500/10',
    },
  } as const;

  const ActionButton = ({ type, label, icon, color, subText, customClick, lastActionText }: { type?: LifeEventType, label: string, icon: React.ReactNode, color: keyof typeof actionPalette, subText: string, customClick?: () => void, lastActionText?: string }) => {
    const palette = actionPalette[color];

    return (
    <button onClick={customClick || (() => handleActionClick(type!))} className={`group relative w-full min-h-[5.5rem] clip-corner flex items-center justify-between gap-3 px-4 py-4 sm:h-24 sm:px-6 transition-all duration-200 border border-gray-800 ${palette.hoverBorder} ${palette.bg} ${palette.hoverBg} active:scale-[0.98]`}>
      <div className="flex min-w-0 items-center gap-3 sm:gap-4 z-10">
        <div className={`shrink-0 p-3 rounded-sm border ${palette.iconBorder} bg-black ${palette.iconText} group-hover:shadow-[0_0_15px_currentColor] transition-shadow`}>{icon}</div>
        <div className="min-w-0 text-left"><div className={`text-base font-bold ${palette.titleText} tracking-wider sm:text-lg`}>{label}</div><div className="text-[10px] text-gray-500 font-mono mt-1 break-words">{subText}</div></div>
      </div>
      <div className="flex shrink-0 flex-col items-end z-10"><div className="text-[10px] text-gray-600 font-mono tracking-widest uppercase mb-1 text-right">Last Action</div><div className="text-xs text-gray-300 font-mono text-right">{lastActionText || (type ? getLastTimeStr(type) : 'N/A')}</div>{type && <div className="mt-2 text-[10px] bg-gray-900 px-2 py-0.5 rounded text-gray-500">TODAY: <span className={`${palette.countText} font-bold`}>{logs.filter(l => l.type === type && l.status !== 'FAILED').length}</span></div>}</div>
      <div className={`absolute inset-0 bg-gradient-to-r from-transparent ${palette.shimmer} to-transparent -translate-x-full group-hover:animate-[shimmer_1s_infinite] pointer-events-none`}></div>
    </button>
    );
  };

  return (
    <div className="p-4 space-y-4 relative">
      <div className="text-center"><h2 className="text-xl text-cyan-400 font-bold tracking-[0.2em] font-[Orbitron]">BIO_METRICS</h2><div className="text-[10px] sm:text-xs text-gray-600 font-mono">TARGET_SLEEP: <span className="text-purple-400">{persona.targetSleepTime}</span></div></div>
      <DailyTimeline />
      <div className="space-y-4"><div className="flex items-center gap-2 mb-2"><div className="w-1 h-3 bg-cyan-600"></div><h3 className="text-xs text-gray-500 tracking-widest font-bold">CONTROL_PANEL</h3></div>
        <ActionButton type="WATER" label="HYDRATE" subText="+5 Energy // 维持渗透压" color="cyan" icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>} />
        <ActionButton type="MEAL" label="INTAKE" subText="需要成分检测 // 炎症管控" color="yellow" icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>} />
        <ActionButton type="NAP" label="NAP" subText="+5 Energy/San // 快速充电" color="blue" icon={<Zap size={24} />} />
        <ActionButton label="Cycle" subText="Track & Analyze" color="pink" icon={<CalendarHeart size={24}/>} customClick={onNavigateToCycleTracker} lastActionText="VIEW"/>
        <ActionButton type="EXERCISE" label="EXERCISE" subText="+30 CR, +10 SAN, -15 Energy" color="orange" icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>} />
        {isSleeping ? <ActionButton type="SLEEP" label="WAKE UP" subText="INITIATE BOOT // 解除休眠" color="green" customClick={() => handleActionClick('SLEEP')} icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>} /> : <ActionButton type="SLEEP" label="STASIS" subText="+10 SAN // 神经元重组" color="purple" icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>} />}
      </div>
      <div className="mt-4 border-t border-gray-800 pt-4">
        <div className="text-[10px] text-gray-500 mb-2 font-mono uppercase">Timeline & Analysis</div>
        <div className="space-y-2 pb-6 max-h-48 overflow-y-auto custom-scrollbar pr-1">
            {logs.length === 0 && <div className="text-xs text-gray-700 italic">等待今日数据录入...</div>}
            {[...logs].reverse().map(log => {
                const timing = analyzeTiming(log.type, log.timestamp);
                let colorClass = 'text-gray-600';
                if (log.type === 'WATER') colorClass = 'text-cyan-600'; else if (log.type === 'MEAL') colorClass = 'text-yellow-600'; else if (log.type === 'WAKE_UP') colorClass = 'text-green-600'; else if (log.type === 'SLEEP') colorClass = 'text-purple-600'; else if (log.type === 'EXERCISE') colorClass = 'text-orange-600'; else if (log.type === 'NAP') colorClass = 'text-blue-600';
                const valueLabel = formatLogValue(log);
                
                const isFailed = log.status === 'FAILED';
                const isPending = log.status === 'PENDING';
                
                return (
                    <div 
                        key={log.id} 
                        onClick={() => handleLogClick(log)}
                        className={`flex justify-between items-center text-xs border-l-2 pl-2 py-1 transition-colors ${
                            isFailed ? 'border-red-500 bg-red-900/10 cursor-pointer hover:bg-red-900/30' : 
                            (log.aiAnalysis ? 'border-gray-800 cursor-pointer hover:bg-gray-900/30' : 'border-gray-800')
                        }`}
                    >
                        <div className="flex flex-col max-w-[72%]">
                            <span className={`font-bold ${isFailed ? 'text-red-500' : colorClass} flex flex-wrap items-center gap-1`}>
                                {log.type} 
                                {isFailed && <AlertTriangle size={10} />}
                                {log.description && <span className="text-gray-500 font-normal truncate">- {log.description}</span>}
                            </span>
                            <span className="font-mono text-[10px] sm:text-xs text-gray-600">
                                {new Date(log.timestamp).toLocaleTimeString()} 
                                {valueLabel && ` // ${valueLabel}`}
                                {isPending && ' [ANALYZING...]'}
                                {isFailed && ' [FAILED - TAP TO RETRY]'}
                            </span>
                        </div>
                        <div className={`text-[10px] font-bold border px-1.5 rounded-sm ${timing.color} border-current opacity-80`}>{timing.status}</div>
                    </div>
                );
            })}
        </div>
      </div>
      
      {selectedLog && (
        <div className="absolute inset-0 z-[60] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]">
            <div className={`w-full max-w-sm border-t-4 border-b-4 bg-[#050505] shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col max-h-[90vh] ${selectedLog.status === 'FAILED' ? 'border-red-500' : 'border-cyan-500'}`}>
                
                <div className={`p-4 border-b border-gray-800 flex justify-between items-center ${selectedLog.status === 'FAILED' ? 'bg-red-900/10' : 'bg-cyan-900/10'}`}>
                    <h3 className={`font-[Orbitron] tracking-[0.2em] font-bold text-lg ${selectedLog.status === 'FAILED' ? 'text-red-500' : 'text-cyan-500'}`}>
                        {selectedLog.status === 'FAILED' ? 'TRANSMISSION_ERROR' : 'LOG_DETAILS'}
                    </h3>
                    <div className="text-[10px] text-gray-500 font-mono">ID: {selectedLog.id.slice(-4)}</div>
                </div>

                <div className="p-5 sm:p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">
                    <div className="grid grid-cols-1 gap-4 border-b border-gray-800 pb-4 sm:grid-cols-2">
                        <div>
                            <div className="text-[10px] text-gray-500 uppercase">TIMESTAMP</div>
                            <div className="text-xs font-mono text-gray-300">
                                {new Date(selectedLog.timestamp).toLocaleString()}
                            </div>
                        </div>
                        <div className="sm:text-right">
                             <div className="text-[10px] text-gray-500 uppercase">STATUS</div>
                             <div className={`text-xs font-mono font-bold ${selectedLog.status === 'FAILED' ? 'text-red-500' : 'text-cyan-400'}`}>
                                 {selectedLog.status}
                             </div>
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">USER_INPUT</div>
                        <div className="bg-gray-900/30 p-3 border border-gray-700 text-gray-200 text-sm font-light font-mono whitespace-pre-wrap">
                            {selectedLog.description || selectedLog.rawInput || "No Content"}
                        </div>
                    </div>

                    {typeof selectedLog.value === 'number' && (
                        <div>
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">VALUE</div>
                            <div className="bg-gray-900/30 p-3 border border-gray-700 text-sm font-mono text-gray-200">
                                {formatLogValue(selectedLog) || selectedLog.value}
                            </div>
                        </div>
                    )}

                    {selectedLog.status === 'SUCCESS' && selectedLog.aiAnalysis && (
                        <div>
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">AI_ANALYSIS</div>
                            <div className="bg-cyan-900/10 p-3 border-l-2 border-cyan-500/50">
                                <MarkdownText text={selectedLog.aiAnalysis} className="text-sm text-cyan-100/90 font-mono leading-relaxed" highlightColor="text-cyan-400" />
                            </div>
                        </div>
                    )}
                    
                    {selectedLog.status === 'FAILED' && (
                        <div className="flex items-center gap-3 p-3 bg-red-950/30 border border-red-900/50">
                            <AlertTriangle className="text-red-500 shrink-0" size={20} />
                            <div className="text-xs text-red-400">
                                Data packet failed to upload to central brain. Cached locally.
                            </div>
                        </div>
                    )}
                    
                    {selectedLog.coinChange !== undefined && (
                        <div className="grid grid-cols-1 gap-4 border-t border-gray-800 pt-4 sm:grid-cols-2">
                            <div className="text-center">
                                <div className="text-[10px] text-gray-500 uppercase">CREDIT_CHANGE</div>
                                <div className={`text-xl font-bold font-mono ${selectedLog.coinChange > 0 ? 'text-yellow-500' : 'text-gray-500'}`}>
                                    {selectedLog.coinChange > 0 ? `+${selectedLog.coinChange}` : selectedLog.coinChange}
                                </div>
                            </div>
                            <div className="text-center">
                                <div className="text-[10px] text-gray-500 uppercase">TYPE</div>
                                <div className="text-xl font-bold font-mono text-gray-300">
                                    {selectedLog.type}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 bg-[#0a0a0a] border-t border-gray-800 flex gap-3">
                    <button onClick={onCloseLogDetail} className="flex-1 py-3 text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-white font-bold tracking-widest clip-corner-sm transition-all">CLOSE</button>
                    {selectedLog.status === 'FAILED' && (
                        <button 
                            onClick={() => {
                                onRetry(selectedLog);
                                onCloseLogDetail();
                            }}
                            className="flex-1 py-3 bg-red-700 text-white hover:bg-red-600 font-bold tracking-widest clip-corner-sm transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(255,0,0,0.3)]"
                        >
                            <RotateCcw size={16} />
                            RETRY
                        </button>
                    )}
                </div>
            </div>
        </div>
      )}

      {isFoodInputOpen && (<div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"><div className="w-full max-w-sm border border-yellow-600 bg-[#0a0a00] p-1 clip-corner shadow-[0_0_30px_rgba(255,200,0,0.2)]"><div className="bg-yellow-900/20 p-4 border border-yellow-900/50 flex flex-col"><div className="flex justify-between items-center mb-2"><h3 className="text-yellow-500 font-bold font-[Orbitron] tracking-widest animate-pulse">ORGANIC_SCANNER</h3><button onClick={onCloseFoodInput} className="text-gray-500 hover:text-white">ABORT</button></div><div className="text-xs text-yellow-700 mb-2 font-mono leading-relaxed">⚠️ 检测到有机物摄入。<br/>系统需进行炎症水平评估。<br/><span className="text-red-500">警告：如实申报。欺骗系统将导致信用降级。</span></div><form onSubmit={submitFood} className="flex flex-col gap-4"><textarea value={foodContent} onChange={(e) => setFoodContent(e.target.value)} placeholder="例如：一份蔬菜沙拉和煎鸡胸肉 (或: 炸鸡全家桶)" className="w-full h-24 bg-black border border-yellow-800 text-yellow-100 p-2 text-sm font-mono focus:border-yellow-400 outline-none resize-none placeholder-yellow-900/50" autoFocus /><button type="submit" className="bg-yellow-600 text-black font-bold py-3 uppercase tracking-widest hover:bg-yellow-500 clip-corner-sm">INITIATE ANALYSIS</button></form></div></div></div>)}
      
      {isNapInputOpen && (
        <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-[fadeIn_0.2s]">
            <div className="w-full max-w-sm border border-blue-600 bg-[#000a1a] p-1 clip-corner shadow-[0_0_30px_rgba(0,100,255,0.2)]">
                <div className="bg-blue-900/20 p-4 border border-blue-900/50 flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-blue-500 font-bold font-[Orbitron] tracking-widest animate-pulse">POWER_RECHARGE</h3>
                        <button onClick={() => setIsNapInputOpen(false)} className="text-gray-500 hover:text-white">ABORT</button>
                    </div>
                    <div className="text-xs text-blue-300 mb-4 font-mono leading-relaxed">
                        系统检测到能量低谷。<br/>建议进行快速充电以恢复神经元活性。<br/>
                        <span className="text-blue-500">选择充电时长:</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        {[15, 20, 30, 45, 60, 90].map(min => (
                            <button 
                                key={min}
                                onClick={() => setNapDuration(min)}
                                className={`py-2 border font-mono text-sm transition-all clip-corner-sm ${napDuration === min ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_10px_rgba(0,100,255,0.5)]' : 'bg-blue-900/10 text-blue-400 border-blue-800 hover:bg-blue-900/30'}`}
                            >
                                {min} MIN
                            </button>
                        ))}
                    </div>
                    <button onClick={submitNap} className="bg-blue-600 text-white font-bold py-3 uppercase tracking-widest hover:bg-blue-500 clip-corner-sm shadow-[0_0_20px_rgba(0,100,255,0.3)]">
                        INITIATE NAP SEQUENCE
                    </button>
                </div>
            </div>
        </div>
      )}
      
      {analysisResult && (
        <div className="absolute inset-0 z-[60] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]">
            <div className={`w-full max-w-sm border-t-4 border-b-4 bg-[#050505] shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col max-h-[90vh] ${analysisResult.isHealthy ? 'border-green-500' : 'border-red-500'}`}>
                <div className={`p-4 border-b border-gray-800 flex justify-between items-center ${analysisResult.isHealthy ? 'bg-green-900/10' : 'bg-red-900/10'}`}>
                    <h3 className={`font-[Orbitron] tracking-[0.2em] font-bold text-base sm:text-lg ${analysisResult.isHealthy ? 'text-green-500' : 'text-red-500'}`}>AUDIT_REPORT</h3>
                    <div className="text-[10px] text-gray-500 font-mono">ID: {Math.floor(Math.random() * 10000)}</div>
                </div>
                <div className="p-5 sm:p-6 space-y-6 overflow-y-auto custom-scrollbar">
                    <div className="text-center">
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">HEALTH_RATING</div>
                        <div className={`text-3xl font-bold font-mono border-2 inline-block px-4 py-1 rounded ${analysisResult.isHealthy ? 'border-green-500 text-green-500 rotate-[-5deg]' : 'border-red-500 text-red-500 rotate-[5deg]'}`}>
                            {analysisResult.isHealthy ? 'OPTIMAL' : 'INFLAMMATORY'}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 border-t border-b border-gray-800 py-4 sm:grid-cols-2">
                        <div className="text-center">
                            <div className="text-[10px] text-gray-500 uppercase">INFLAMMATION_TAX</div>
                            <div className={`text-xl font-bold font-mono ${analysisResult.coinChange >= 0 ? 'text-gray-600' : 'text-red-500'}`}>
                                {analysisResult.coinChange < 0 ? `${analysisResult.coinChange} CR` : 'NONE'}
                            </div>
                        </div>
                        <div className="text-center">
                            <div className="text-[10px] text-gray-500 uppercase">PERFORMANCE_BONUS</div>
                            <div className={`text-xl font-bold font-mono ${analysisResult.coinChange > 0 ? 'text-yellow-500' : 'text-gray-600'}`}>
                                {analysisResult.coinChange > 0 ? `+${analysisResult.coinChange} CR` : 'NONE'}
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-900/30 p-3 border-l-2 border-gray-700">
                        <div className="text-[10px] text-gray-500 mb-2 font-bold">AI_OBSERVER_NOTE:</div>
                        <MarkdownText text={analysisResult.analysis} className="text-sm text-gray-300 font-mono leading-relaxed" />
                    </div>
                    <div className="flex flex-col gap-2 text-[10px] font-mono text-gray-500 sm:flex-row sm:justify-between">
                        <span>ENERGY: {analysisResult.energyChange > 0 ? '+' : ''}{analysisResult.energyChange}%</span>
                        <span>SANITY: {analysisResult.sanChange > 0 ? '+' : ''}{analysisResult.sanChange}%</span>
                    </div>
                </div>
                <div className="p-4 bg-[#0a0a0a] border-t border-gray-800">
                    <button onClick={onCloseAnalysis} className={`w-full py-3 font-bold tracking-widest clip-corner-sm hover:brightness-110 transition-all ${analysisResult.isHealthy ? 'bg-green-700 text-white' : 'bg-red-900 text-red-100'}`}>
                        ACKNOWLEDGE & FILE
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default BioMonitor;
