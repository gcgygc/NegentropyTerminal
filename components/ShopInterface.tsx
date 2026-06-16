
import React, { useState } from 'react';
import { GachaItem, UserStats, PersonaConfig, AIConfig, CustomPrompts } from '../types';
import * as GeminiService from '../services/geminiService';
import { extractHapticMarkers, scheduleHapticPlayback, recordSkippedHaptic } from '../services/hapticPatterns';
import MarkdownText from './MarkdownText';

interface ShopInterfaceProps {
  stats: UserStats;
  persona: PersonaConfig;
  aiConfig: AIConfig;
  prompts: CustomPrompts; 
  customItems: GachaItem[];
  onUpdateStats: (newStats: UserStats) => void;
  onUpdateItems: (newItems: GachaItem[]) => void;
  showNotification: (t: string, b: string) => void;
  
  // Navigation
  gachaResult: { item: string; text: string } | null;
  setGachaResult: (result: { item: string; text: string } | null) => void;
}

const ShopInterface: React.FC<ShopInterfaceProps> = ({ stats, persona, aiConfig, prompts, customItems, onUpdateStats, onUpdateItems, showNotification, gachaResult, setGachaResult }) => {
  const [newItemName, setNewItemName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    const item: GachaItem = {
        id: Date.now().toString(),
        name: newItemName.trim(),
    };
    onUpdateItems([...customItems, item]);
    setNewItemName('');
    showNotification("DATABASE_UPDATE", `已将 "${item.name}" 录入奖励池`);
  };

  const handleRemoveItem = (id: string) => {
    onUpdateItems(customItems.filter(i => i.id !== id));
  };

  const handleGacha = async () => {
    if (stats.coins < 100) {
        showNotification("ERROR", "INSUFFICIENT FUNDS");
        return;
    }

    onUpdateStats({ ...stats, coins: stats.coins - 100 });
    setIsProcessing(true);

    let wonItemName = "SSR: 强制休息券"; 
    if (customItems.length > 0) {
        const randomIndex = Math.floor(Math.random() * customItems.length);
        wonItemName = customItems[randomIndex].name;
    }

    try {
        const rawFlavorText = await GeminiService.generateGachaFlavorText(wonItemName, persona, aiConfig, prompts);
        const gachaHaptics = extractHapticMarkers(rawFlavorText);
        const cleanFlavorText = gachaHaptics.cleanText;
        if (!gachaHaptics.cues.length) {
            const reason = gachaHaptics.skipReason === 'invalid_custom_pattern'
                ? 'invalid_custom_pattern'
                : gachaHaptics.skipReason === 'unknown_emotion'
                    ? 'unknown_emotion'
                    : 'missing_marker';
            recordSkippedHaptic('gacha', reason, gachaHaptics.rawEmotion, gachaHaptics.resolvedEmotion, gachaHaptics.cueType, gachaHaptics.parseError);
        } else {
            scheduleHapticPlayback(gachaHaptics.cues, 'next-frame', 'gacha');
        }
        setGachaResult({ item: wonItemName, text: cleanFlavorText });
    } finally {
        setIsProcessing(false);
    }
  };

  const handleUnlockChat = () => {
    if (stats.coins < 50) {
        showNotification("ERROR", "INSUFFICIENT FUNDS");
        return;
    }
    onUpdateStats({ 
        ...stats, 
        coins: stats.coins - 50,
        unlockedChatTurns: stats.unlockedChatTurns + 10 
    });
    showNotification("SYSTEM", "通讯模块已解锁 (10回合)");
  };

  return (
    <div className="relative h-full overflow-y-auto space-y-8 px-4 pb-32 pt-3 sm:mt-4 sm:p-6">
        <div className="text-center space-y-2">
            <h2 className="text-2xl text-yellow-500 font-bold neon-text-red font-[Orbitron] tracking-wider sm:text-3xl">SUPPLY_DEPOT</h2>
            <div className="text-[10px] text-gray-500 border-t border-b border-gray-800 py-1 w-full max-w-xs mx-auto">
                REWARD_SYSTEM_V2.0
            </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
            <button 
                onClick={handleGacha}
                disabled={isProcessing}
                className="w-full group relative py-6 border border-yellow-600 bg-yellow-900/10 clip-corner hover:bg-yellow-900/30 transition-all overflow-hidden"
            >
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZjMTA3IiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')] opacity-50"></div>
                <div className="relative z-10 flex flex-col items-center">
                <span className="text-yellow-500 font-bold text-xl tracking-widest">{isProcessing ? 'DISPENSING...' : '[ GACHA BOX ]'}</span>
                <span className="text-[10px] text-yellow-700 mt-1">COST: 100 CR</span>
                </div>
            </button>

            <button 
                onClick={handleUnlockChat}
                className="w-full py-6 border border-blue-600 bg-blue-900/10 clip-corner hover:bg-blue-900/30 transition-all text-center"
            >
                <div className="flex flex-col items-center">
                <span className="text-blue-500 font-bold text-xl tracking-widest">[ DEEP LINK ]</span>
                <span className="text-[10px] text-blue-700 mt-1">COST: 50 CR / 10 TURNS</span>
                </div>
            </button>
        </div>

        <div className="border-t border-gray-800 pt-6 space-y-4">
            <div className="flex items-center gap-2">
                <div className="w-1 h-4 bg-yellow-600"></div>
                <h3 className="text-xs text-gray-500 tracking-[0.2em] font-bold">CUSTOM_REWARDS_DB</h3>
            </div>
            
            <div className="flex flex-col gap-2 sm:flex-row">
                <input 
                    type="text" 
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="输入想要的奖励 (如: 喝奶茶)"
                    className="flex-1 bg-gray-900 border border-gray-700 text-white p-2 text-sm focus:border-yellow-500 outline-none clip-corner-sm"
                />
                <button 
                    onClick={handleAddItem}
                    className="bg-yellow-900/50 text-yellow-400 px-4 py-2 text-xs font-bold border border-yellow-700 hover:bg-yellow-800 hover:text-white clip-corner-sm sm:w-auto"
                >
                    ADD
                </button>
            </div>

            <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1 sm:max-h-40 sm:pr-2">
                {customItems.length === 0 && <div className="text-gray-600 text-xs text-center py-2">这里空空如也，快添加一些让自己开心的东西吧</div>}
                {customItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-2 bg-[#111] p-2 border-l-2 border-gray-700">
                        <span className="min-w-0 flex-1 break-words pr-2 text-sm text-gray-300">{item.name}</span>
                        <button onClick={() => handleRemoveItem(item.id)} className="text-red-500 hover:text-red-400 text-xs">[DEL]</button>
                    </div>
                ))}
            </div>
        </div>

        {gachaResult && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
                <div className="relative w-full max-w-sm flex flex-col max-h-[85vh] drop-shadow-[0_0_15px_rgba(255,200,0,0.2)]">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-black px-4 text-yellow-500 font-bold tracking-widest border border-yellow-900 text-xs z-20 whitespace-nowrap">
                        ACQUISITION CONFIRMED
                    </div>
                    
                    <div className="bg-[#111] border border-yellow-500 w-full relative clip-corner flex flex-col min-h-0">
                        <div className="flex-1 overflow-y-auto p-6 pb-2 custom-scrollbar pt-6">
                            <div className="text-center space-y-4 py-4">
                                <div className="w-16 h-16 bg-yellow-900/20 rounded-full mx-auto flex items-center justify-center border border-yellow-500/50 animate-bounce shrink-0">
                                    <span className="text-2xl">🎁</span>
                                </div>
                                
                                <div>
                                    <h3 className="text-xl text-white font-bold mb-1">{gachaResult.item}</h3>
                                    <div className="border-t border-b border-yellow-900/30 py-4 my-2 text-left">
                                        <MarkdownText 
                                            text={gachaResult.text} 
                                            className="text-sm text-yellow-100/90 font-mono"
                                            highlightColor="text-yellow-400" 
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 pt-2 bg-[#111] z-10 shrink-0">
                            <button 
                                onClick={() => setGachaResult(null)}
                                className="w-full py-3 bg-yellow-600 text-black font-bold tracking-widest hover:bg-yellow-500 clip-corner-sm"
                            >
                                ACCEPT REWARD
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default ShopInterface;
