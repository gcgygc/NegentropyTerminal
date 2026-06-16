

import React, { useState, useEffect, useRef } from 'react';

interface FocusSessionProps {
  durationMinutes: number;
  onSuccess: (duration: number) => void;
  onFail: () => void; // 这里的 fail 指的是切后台等被动失败
  onAbort: () => void; // 新增：主动中止（惩罚）
  onBack: () => void; // 新增：设置阶段返回（无惩罚）
  onStatusChange: (isActive: boolean) => void; // 新增：通知父组件状态变化
}

const FocusSession: React.FC<FocusSessionProps> = ({ durationMinutes, onSuccess, onFail, onAbort, onBack, onStatusChange }) => {
  // 内部状态管理设置的时长
  const [setupTime, setSetupTime] = useState(durationMinutes); 
  const [timeLeft, setTimeLeft] = useState(durationMinutes * 60);
  const [isActive, setIsActive] = useState(false);
  const totalTimeRef = useRef(durationMinutes * 60);

  // Notify parent whenever active state changes
  useEffect(() => {
      onStatusChange(isActive);
      return () => onStatusChange(false); // Cleanup: ensure nav bar comes back if component unmounts
  }, [isActive, onStatusChange]);

  // 当处于待机状态时，修改 setupTime 会同步更新 timeLeft
  useEffect(() => {
    if (!isActive) {
        setTimeLeft(setupTime * 60);
        totalTimeRef.current = setupTime * 60;
    }
  }, [setupTime, isActive]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isActive) {
        setIsActive(false);
        onFail();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isActive, onFail]);

  useEffect(() => {
    // FIX: The return type of `setInterval` in a browser environment is `number`, not `NodeJS.Timeout`.
    // Using `ReturnType<typeof setInterval>` provides the correct type automatically.
    let interval: ReturnType<typeof setInterval>;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isActive) {
      setIsActive(false);
      onSuccess(setupTime);
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft, onSuccess, setupTime]);

  // 滑块调整时间
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isActive) return;
      const val = parseInt(e.target.value, 10);
      setSetupTime(val);
  };

  const handleAdjustTime = (delta: number) => {
    if (isActive) return;
    setSetupTime(prev => Math.min(180, Math.max(1, prev + delta)));
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = isActive 
    ? ((totalTimeRef.current - timeLeft) / totalTimeRef.current) * 100 
    : 0; 
  
  const dashOffset = isActive 
      ? 283 - (283 * progress) / 100 
      : 0; // 0 表示满环

  const isCritical = isActive && progress > 90;

  return (
    <div className="flex flex-col items-center justify-center h-full relative overflow-hidden bg-black">
      {/* 复杂的背景装饰 */}
      <div className="absolute inset-0 bg-grid-move opacity-20 pointer-events-none"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-[radial-gradient(circle,rgba(0,50,20,0.2)_0%,rgba(0,0,0,1)_70%)] pointer-events-none"></div>

      {/* 顶部状态 */}
      <div className="z-10 text-center space-y-1 mb-6 sm:mb-8 px-4">
        <h2 className={`text-2xl font-bold tracking-[0.2em] font-[Orbitron] ${isActive ? 'text-green-400 neon-text-green' : 'text-gray-500'}`}>
          QUANTUM_DIVE
        </h2>
        <div className="flex justify-center items-center gap-2 text-[11px] text-green-800">
           <span className="w-1 h-1 bg-green-500 rounded-full"></span>
           STATUS: {isActive ? 'SYNCED' : 'CALIBRATING...'}
           <span className="w-1 h-1 bg-green-500 rounded-full"></span>
        </div>
      </div>

      {/* 核心反应堆 UI */}
      <div className="relative w-72 h-72 flex items-center justify-center z-10">
        {/* 外环装饰 */}
        <div className="absolute w-full h-full rounded-full border border-green-900/50 border-dashed animate-[spin_10s_linear_infinite]"></div>
        <div className="absolute w-[90%] h-[90%] rounded-full border border-green-800/30 animate-[spin_15s_linear_infinite_reverse]"></div>
        
        {/* 动态进度环 - 修复 viewBox 问题 */}
        <svg className="absolute w-full h-full -rotate-90" viewBox="0 0 100 100">
            {/* 背景轨道 */}
            <circle cx="50" cy="50" r="45" fill="none" stroke="#111" strokeWidth="6" />
            {/* 进度条 */}
            <circle 
                cx="50" cy="50" r="45" fill="none" stroke={isCritical ? "#ff003c" : "#00ff41"} strokeWidth="6"
                strokeDasharray="283"
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-linear drop-shadow-[0_0_8px_rgba(0,255,65,0.5)]"
            />
        </svg>

        {/* 中心倒计时 & 控制区 */}
        <div className="flex flex-col items-center justify-center bg-black/80 w-[70%] h-[70%] rounded-full border border-green-500/50 backdrop-blur-sm shadow-[inset_0_0_20px_rgba(0,255,65,0.2)]">
            
            <div className="flex items-center justify-center gap-2">
                 {/* 减少时间按钮 */}
                 {!isActive && (
                    <button 
                        onClick={() => handleAdjustTime(-5)} 
                        className="text-green-800 hover:text-green-400 transition-colors p-2 active:scale-95"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>
                )}

                <div className={`text-5xl font-mono font-bold tracking-tighter transition-all ${isCritical ? 'text-red-500 animate-pulse neon-text-red' : 'text-white neon-text-green'}`}>
                    {isActive ? formatTime(timeLeft) : setupTime}
                    {!isActive && <span className="text-sm text-green-700 ml-1">m</span>}
                </div>

                {/* 增加时间按钮 */}
                {!isActive && (
                    <button 
                        onClick={() => handleAdjustTime(5)} 
                        className="text-green-800 hover:text-green-400 transition-colors p-2 active:scale-95"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>
                )}
            </div>

            <div className="text-[11px] text-green-700 mt-2 font-mono tracking-widest uppercase">
                {isActive ? "T-MINUS" : "TARGET_DURATION"}
            </div>
        </div>
      </div>

      {/* 自由调节滑块 (仅在待机时显示) */}
      {!isActive && (
        <div className="w-64 mt-6 z-20 flex flex-col items-center space-y-2 animate-fadeIn">
            <input 
                type="range" 
                min="1" 
                max="120" 
                value={setupTime} 
                onChange={handleSliderChange}
                className="w-full h-2 bg-green-900/30 rounded-lg appearance-none cursor-pointer accent-green-500 hover:accent-green-400"
            />
            <div className="flex justify-between w-full text-[10px] text-green-800 font-mono">
                <span>1m</span>
                <span>CUSTOM_RANGE</span>
                <span>120m</span>
            </div>
        </div>
      )}

      {/* 控制按钮区域 */}
      <div className={`z-10 flex flex-col items-center gap-4 w-full px-5 sm:px-8 ${isActive ? 'mt-10 sm:mt-12' : 'mt-6'}`}>
        {!isActive && (
           <div className="flex gap-2 w-full">
               <button 
                 onClick={() => setIsActive(true)}
                 className="flex-1 clip-corner bg-green-600 hover:bg-green-500 text-black font-bold text-lg py-4 transition-all hover:scale-[1.02] shadow-[0_0_20px_rgba(0,255,0,0.3)] group relative overflow-hidden"
               >
                 <span className="relative z-10 flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    INITIATE
                 </span>
                 {/* 按钮内扫光动画 */}
                 <div className="absolute top-0 -left-[100%] w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12 group-hover:animate-[shimmer_1s_infinite]"></div>
               </button>
           </div>
        )}
        
        {isActive && (
            <div className="w-full text-center p-3 border border-red-900/80 bg-red-950/30 text-[10px] sm:text-xs font-mono tracking-[0.15em] clip-corner animate-pulse leading-relaxed">
                ⚠ WARNING: APP SWITCHING = HULL BREACH
            </div>
        )}

        {isActive ? (
             <button 
             onClick={onAbort}
             className="px-4 py-2 text-xs font-mono tracking-widest text-red-800 hover:text-red-500 transition-colors border border-red-900/30 hover:border-red-500 clip-corner-sm"
             >
             [ ABORT MISSION ]
             </button>
        ) : null}
      </div>
    </div>
  );
};

export default FocusSession;
