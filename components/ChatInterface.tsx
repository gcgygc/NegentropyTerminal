import React, { useState, useEffect, useRef } from 'react';
// FIX: Import CycleDayLog type to use in props.
import { ChatMessage, PersonaConfig, JournalLog, ChatSession, AIConfig, CustomPrompts, MemoryLog, LifeLog, CycleDayLog } from '../types';
import * as GeminiService from '../services/geminiService';
import MarkdownText from './MarkdownText';
import { MemoryBankModal } from './MemoryBankModal';
import { Edit2, RefreshCw, X, Check, BrainCircuit, Square, CheckSquare, MessageSquarePlus, Database, Trash2 } from 'lucide-react';

interface ChatInterfaceProps {
  config: PersonaConfig;
  aiConfig: AIConfig;
  prompts: CustomPrompts; 
  recentLogs: JournalLog[];
  memoryBank: MemoryLog[];
  todayBioLogs: LifeLog[]; // 新增：今日 BIO 数据
  // FIX: Add cycleDayLogs to props interface.
  cycleDayLogs: CycleDayLog[];
  unlockedTurns: number;
  onTurnUsed: () => void;
  
  // Navigation State Props (Lifted Up)
  activeSessionId: string | null;
  isMemoryBankOpen: boolean;
  isManualMemoryOpen: boolean;

  // Navigation Callbacks
  onSelectSession: (sessionId: string) => void;
  onOpenMemoryBank: () => void;
  onCloseMemoryBank: () => void;
  onOpenManualMemory: () => void;
  onCloseManualMemory: () => void;
  onBack: () => void; // Unifies "Close" and "Back"
  
  sessions: ChatSession[];
  onSaveSession: (session: ChatSession) => void;
  onDeleteSession: (sessionId: string) => void;
  onCreateSession: (name: string) => ChatSession;
  showNotification: (title: string, body: string) => void;
  
  onAddMemory: (memory: MemoryLog, coins: number) => void;
  onDeleteMemory: (id: string) => void;
  onUpdateMemory: (id: string, newContent: string) => void;
  onToggleMemoryEnabled: (id: string) => void;

  // New Props
  onSendMessage: (sessionId: string, text: string) => Promise<void>;
  onRegenerateMessage: (sessionId: string) => Promise<void>;
  onRetryMessage: (sessionId: string, messageId: string) => Promise<void>;
  isThinking: boolean;
  canStopGeneration?: boolean;
  onStopGeneration?: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    config, aiConfig, prompts, recentLogs, memoryBank, todayBioLogs, cycleDayLogs, unlockedTurns, onTurnUsed, 
    activeSessionId, isMemoryBankOpen, isManualMemoryOpen,
    onSelectSession, onOpenMemoryBank, onCloseMemoryBank, onOpenManualMemory, onCloseManualMemory, onBack,
    sessions, onSaveSession, onDeleteSession, onCreateSession, showNotification, onAddMemory, onDeleteMemory, onUpdateMemory, onToggleMemoryEnabled,
    onSendMessage, onRegenerateMessage, onRetryMessage, isThinking, canStopGeneration = false, onStopGeneration
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false); 
  const [isSummarizing, setIsSummarizing] = useState(false); 
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMounted = useRef(true);

  const isProcessing = isThinking || isTyping;

  const [newSessionName, setNewSessionName] = useState('');
  const [isRenaming, setIsRenaming] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null);
  const [sessionSearchTerm, setSessionSearchTerm] = useState('');

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [manualMemoryContent, setManualMemoryContent] = useState('');
  const [expandedThinkings, setExpandedThinkings] = useState<Set<string>>(new Set());

  const activeSession = sessions.find(s => s.id === activeSessionId);

  useEffect(() => {
    isMounted.current = true;
    return () => {
        isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (activeSessionId && activeSession) {
      setMessages(activeSession.messages);
      
      if (activeSession.messages.length === 0) {
          const introMsg = `已建立安全连接。我是 ${config.name}。档案 "${activeSession.name}" 已开启。请讲。`;
          const newMsg: ChatMessage = { id: Date.now().toString(), role: 'model', text: introMsg, timestamp: Date.now() };
          setMessages([newMsg]);
          onSaveSession({ ...activeSession, messages: [newMsg], lastModified: Date.now() });
      }
    } else {
        setMessages([]);
    }
  }, [activeSessionId, config, sessions]); 

  const prevMsgCount = useRef(messages.length);

  useEffect(() => {
    if (scrollRef.current) {
      // Only scroll to bottom if:
      // 1. New message added (length increased)
      // 2. AI starts thinking
      if (messages.length > prevMsgCount.current || isProcessing) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
    prevMsgCount.current = messages.length;
  }, [messages, isProcessing]); 

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const saveCurrentMessagesToSession = (msgs: ChatMessage[]) => {
      if (activeSession) {
          onSaveSession({ ...activeSession, messages: msgs, lastModified: Date.now() });
      }
  };

  const handleSend = async () => {
    if (!input.trim() || unlockedTurns <= 0 || !activeSessionId) return;
    const textToSend = input;
    setInput('');
    
    try {
        await onSendMessage(activeSessionId, textToSend);
    } catch (error: any) {
        if (!isMounted.current) return;
        setInput(textToSend); // Restore input on failure
        showNotification("TRANSMISSION_FAILED", `发送失败，内容已回退到输入框。\nReason: ${error.message || "Unknown"}`);
    }
  };


  const handleCreate = () => {
      const name = newSessionName.trim() || `Session ${new Date().toLocaleDateString()}`;
      const newSession = onCreateSession(name);
      onSelectSession(newSession.id);
      setNewSessionName('');
  };

  const startRename = (s: ChatSession) => { setIsRenaming(s.id); setRenameInput(s.name); };
  const confirmRename = () => {
      if (isRenaming) {
          const session = sessions.find(s => s.id === isRenaming);
          if (session) onSaveSession({ ...session, name: renameInput });
          setIsRenaming(null);
      }
  };
  const confirmDelete = () => { if (sessionToDelete) { onDeleteSession(sessionToDelete.id); setSessionToDelete(null); } };

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.text);
  };

  const handleSaveEdit = () => {
    if (!editingMessageId) return;
    const updatedMessages = messages.map(m => 
      m.id === editingMessageId ? { ...m, text: editContent } : m
    );
    setMessages(updatedMessages);
    saveCurrentMessagesToSession(updatedMessages);
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };
  
  const handleDeleteMessage = (messageId: string) => {
    const updatedMessages = messages.filter(m => m.id !== messageId);
    setMessages(updatedMessages);
    saveCurrentMessagesToSession(updatedMessages);
    showNotification("SYSTEM", "Message deleted.");
  };

  const handleRegenerate = async () => {
    if (!activeSessionId) return;
    try {
        await onRegenerateMessage(activeSessionId);
    } catch (error: any) {
        showNotification("REGEN_FAILED", error.message);
    }
  };

  const toggleSelectionMode = () => {
      setIsSelectionMode(!isSelectionMode);
      setSelectedMsgIds(new Set());
  };

  const toggleMessageSelection = (id: string) => {
      if (!isSelectionMode) return;
      const newSet = new Set(selectedMsgIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedMsgIds(newSet);
  };
  
  const handleArchiveAll = async () => {
      if (messages.length === 0) {
          showNotification("SYSTEM", "当前会话为空，无法归档。");
          return;
      }
      
      setIsSummarizing(true);
      try {
          const summary = await GeminiService.summarizeChatToMemory(messages, config, aiConfig, prompts);
          
          if (summary.mood_tag === "ERROR") {
              throw new Error(summary.reply);
          }

          const newMemory: MemoryLog = {
              id: Date.now().toString(),
              timestamp: Date.now(),
              content: summary.reply,
              tags: [summary.mood_tag, activeSession?.name || 'Unknown'],
              source: 'CHAT_ARCHIVE'
          };
          
          onAddMemory(newMemory, 0);
          showNotification("ARCHIVE SUCCESS", "已成功总结整个会话并存入记忆库。");

      } catch (e: any) {
          showNotification("ARCHIVE FAILED", e.message);
      } finally {
          setIsSummarizing(false);
      }
  };

  const handleArchiveSelected = async (archiveType: 'SUMMARIZE' | 'RAW') => {
      if (selectedMsgIds.size === 0) {
          showNotification("SYSTEM", "请先选择至少一条消息");
          return;
      }
      const selectedMsgs = messages.filter(m => selectedMsgIds.has(m.id)).sort((a,b) => a.timestamp - b.timestamp);
      const contentText = selectedMsgs.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n\n');

      setIsSummarizing(true);
      try {
          let memoryContent = "";
          let moodTag = "SAVED";
          let coins = 0; // 归档不奖励金币

          if (archiveType === 'SUMMARIZE') {
              const summary = await GeminiService.summarizeSelectedChatToMemory(contentText, config, aiConfig, prompts);
              memoryContent = summary.reply;
              moodTag = summary.mood_tag;
          } else {
              memoryContent = `【对话摘录】\n${contentText}`;
              moodTag = "RAW_ARCHIVE";
          }

          const newMemory: MemoryLog = {
              id: Date.now().toString(),
              timestamp: Date.now(),
              content: memoryContent,
              tags: [moodTag, activeSession?.name || 'Unknown'],
              source: 'CHAT_ARCHIVE'
          };
          
          onAddMemory(newMemory, coins);
          showNotification("ARCHIVE SUCCESS", archiveType === 'SUMMARIZE' ? "已生成总结并存入记忆库" : "已原样存入记忆库");
          setIsSelectionMode(false);
          setSelectedMsgIds(new Set());
      } catch (e: any) {
          showNotification("ARCHIVE FAILED", e.message);
      } finally {
          setIsSummarizing(false);
      }
  };

  const handleManualMemorySubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!manualMemoryContent.trim()) return;
      
      const newMemory: MemoryLog = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          content: manualMemoryContent,
          tags: ["MANUAL"],
          source: 'MANUAL'
      };
      
      onAddMemory(newMemory, 0); // 手动添加不奖励金币
      showNotification("MEMORY SAVED", "手动记忆已保存到 Global Memory");
      onCloseManualMemory();
      setManualMemoryContent('');
  };

  const actionableMessages = messages.filter(
    message =>
      !message.transientType &&
      !message.text.startsWith('[SYSTEM:') &&
      !message.text.startsWith('【系统提示】')
  );
  const lastActionableMessageId = actionableMessages[actionableMessages.length - 1]?.id;

  const headerActionButtonClass = 'h-7 w-7 shrink-0 justify-center rounded-sm border px-0 py-0 text-[10px] transition-all shadow-none sm:h-auto sm:w-auto sm:px-2 sm:py-1.5 sm:rounded';
  const headerLabelClass = 'hidden sm:inline';
  
  if (!activeSessionId) {
      const filteredSessions = sessions.filter(s =>
        s.name.toLowerCase().includes(sessionSearchTerm.toLowerCase())
      ).sort((a,b) => {
          if (a.id === 'system_core_overseer') return -1;
          if (b.id === 'system_core_overseer') return 1;
          return b.lastModified - a.lastModified;
      });

      return (
        <div className="flex flex-col h-full bg-[#050505] absolute inset-0 z-50 overflow-hidden font-mono">
            <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900/50"><div className="flex items-center gap-2"><div className="w-2 h-2 bg-yellow-500 rounded-full"></div><span className="text-yellow-500 font-bold text-sm tracking-widest">CHAT_ARCHIVES</span></div><button onClick={onBack} className="text-gray-500 hover:text-white text-xs">[EXIT SYSTEM]</button></div>
            
            <div className="p-4 border-b border-gray-800">
                <div className="relative">
                    <input 
                        type="text" 
                        value={sessionSearchTerm}
                        onChange={(e) => setSessionSearchTerm(e.target.value)}
                        placeholder="搜索会话..."
                        className="w-full bg-gray-900 border border-gray-700 text-white p-2 pl-8 text-xs focus:border-yellow-500 outline-none clip-corner-sm"
                    />
                    <svg className="w-4 h-4 text-gray-500 absolute left-2 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
            </div>

            <div className="p-4 border-b border-gray-800 flex gap-2"><input type="text" value={newSessionName} onChange={(e) => setNewSessionName(e.target.value)} placeholder="输入会话名称 (可选)..." className="flex-1 bg-gray-900 border border-gray-700 text-white p-2 text-xs focus:border-green-500 outline-none clip-corner-sm"/><button onClick={handleCreate} className="bg-green-900/30 text-green-400 px-3 text-xs border border-green-700 hover:bg-green-800 hover:text-white clip-corner-sm whitespace-nowrap">+ NEW LINK</button></div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {filteredSessions.length === 0 && <div className="text-gray-600 text-xs text-center mt-10">{sessionSearchTerm ? 'NO_MATCHING_ARCHIVES' : 'NO_ARCHIVES_FOUND'}</div>}
                {filteredSessions.map(session => {
                    const isOverseer = session.id === 'system_core_overseer';
                    return (
                        <div 
                            key={session.id} 
                            className={`bg-[#111] border-l-2 p-3 flex justify-between items-center transition-all group clip-corner-sm
                                ${isOverseer 
                                    ? 'border-purple-600 bg-purple-900/10 shadow-[0_0_15px_rgba(147,51,234,0.1)]' 
                                    : 'border-gray-700 hover:bg-gray-900 hover:border-blue-500'}`}
                        >
                            <div className="flex-1 cursor-pointer" onClick={() => onSelectSession(session.id)}>
                                {isRenaming === session.id && !isOverseer ? (
                                    <input 
                                        value={renameInput} 
                                        onChange={(e) => setRenameInput(e.target.value)} 
                                        onBlur={confirmRename} 
                                        onKeyDown={(e) => e.key === 'Enter' && confirmRename()} 
                                        autoFocus 
                                        className="bg-black text-white text-sm border-none outline-none w-full" 
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <div>
                                        <div className={`text-sm font-bold mb-1 flex items-center gap-2 ${isOverseer ? 'text-purple-400' : 'text-gray-300 group-hover:text-blue-400'}`}>
                                            {isOverseer && <BrainCircuit size={14} className="animate-pulse" />}
                                            {session.name}
                                        </div>
                                        <div className="text-[10px] text-gray-600">
                                            {isOverseer ? 'CORE_SYSTEM_AUTHORITY' : `Last Active: ${new Date(session.lastModified).toLocaleDateString()}`} · {session.messages.length} msgs
                                        </div>
                                    </div>
                                )}
                            </div>
                            {!isOverseer && (
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => { e.stopPropagation(); startRename(session); }} className="text-gray-500 hover:text-white text-xs">[EDIT]</button>
                                    <button onClick={(e) => { e.stopPropagation(); setSessionToDelete(session); }} className="text-red-900 hover:text-red-500 text-xs">[DEL]</button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {sessionToDelete && (<div className="fixed inset-0 z-[101] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.2s]"><div className="w-full max-w-sm border border-red-500 bg-[#1a0505] p-1 clip-corner shadow-[0_0_30px_rgba(255,0,60,0.3)]"><div className="bg-red-900/20 p-6 border border-red-900/50 h-full flex flex-col items-center text-center"><h3 className="text-red-400 font-bold font-[Orbitron] tracking-widest mb-2">DELETE ARCHIVE?</h3><p className="text-sm text-gray-300 mb-6 font-mono">This action will permanently erase the chat session "{sessionToDelete.name}".</p><div className="flex w-full gap-4"><button onClick={() => setSessionToDelete(null)} className="flex-1 py-3 bg-gray-700 text-gray-200 hover:bg-gray-600 font-bold tracking-widest clip-corner-sm transition-colors">CANCEL</button><button onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white hover:bg-red-500 font-bold tracking-widest clip-corner-sm transition-colors">DELETE</button></div></div></div></div>)}
        </div>
      );
  }

  return (
    <div className="flex flex-col h-full bg-black/95 absolute inset-0 z-50">
      <div className="flex items-center gap-2 p-3 sm:p-4 border-b border-blue-900 bg-blue-950/20 shrink-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-1 sm:pr-3">
              <button
                  onClick={onBack}
                  className="shrink-0 text-blue-500 hover:text-white text-xs sm:text-sm"
                  aria-label="Back"
                  title="Back"
              >
                  <span className="text-xl leading-none sm:hidden">&lt;</span>
                  <span className="hidden sm:inline">&lt; BACK</span>
              </button>
              <span className="min-w-0 truncate text-blue-300 font-bold text-base sm:text-sm md:text-base tracking-[0.16em] sm:tracking-wider">
                  //{activeSession?.name.toUpperCase()}
              </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
              <button onClick={onOpenMemoryBank} className={`${headerActionButtonClass} flex items-center gap-1 text-blue-300 hover:text-white border-blue-900/50 bg-blue-950/10 hover:bg-blue-900/15`} title="查看全局记忆库" aria-label="Memory bank">
                  <Database size={11}/>
                  <span className={headerLabelClass}>MEMORY BANK</span>
              </button>
              <button onClick={onOpenManualMemory} className={`${headerActionButtonClass} flex items-center gap-1 text-gray-400 hover:text-white border-gray-800/80 bg-gray-950/20 hover:bg-gray-900/25`} title="手动写入记忆" aria-label="Add note">
                  <MessageSquarePlus size={11}/>
                  <span className={headerLabelClass}>ADD NOTE</span>
              </button>
              <button onClick={toggleSelectionMode} className={`${headerActionButtonClass} flex items-center gap-1 transition-all ${isSelectionMode ? 'text-yellow-400 border-yellow-500/80 bg-yellow-900/20' : 'text-gray-400 border-gray-700/80 hover:text-white bg-transparent'}`} title="选择模式" aria-label="Selection mode">
                  {isSelectionMode ? <CheckSquare size={11} /> : <Square size={11} />}
                  <span className={headerLabelClass}>{isSelectionMode ? 'SELECTING...' : 'SELECT'}</span>
              </button>
              <button onClick={handleArchiveAll} disabled={isSummarizing || isSelectionMode} className={`${headerActionButtonClass} ${isSelectionMode ? 'hidden' : 'flex'} items-center gap-1 transition-all text-green-400 border-green-900/50 bg-green-950/10 hover:text-green-300 hover:bg-green-900/15`} title="归档全部记忆" aria-label="Archive chat">
                  {isSummarizing ? <div className="animate-spin w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full"/> : <BrainCircuit size={11}/>}
                  <span className={headerLabelClass}>ARCHIVE</span>
              </button>
          </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
        {messages.map((msg, index) => {
            const isEditing = editingMessageId === msg.id;
            const isLastActionableMessage = msg.id === lastActionableMessageId;
            const isSelected = selectedMsgIds.has(msg.id);
            const isTransient = !!msg.transientType;
            
            // --- AESTHETIC REFACTOR: Handle system messages ---
            // Fix: Include messages starting with '【系统提示】' in the system message styling.
            // Fix: Add a delete button to system messages.
            if (msg.text.startsWith('[SYSTEM:') || msg.text.startsWith('【系统提示】')) {
                return (
                    <div key={msg.id} className="flex justify-start items-center group">
                        <div className="text-blue-500 text-xs animate-pulse font-mono pl-2 py-2">
                            {msg.text}
                        </div>
                        {!isTransient && (
                            <button 
                                 onClick={() => handleDeleteMessage(msg.id)} 
                                 className="ml-2 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                 title="删除系统消息"
                             >
                                 <Trash2 size={12} />
                             </button>
                        )}
                    </div>
                );
            }

            if (msg.status === 'FAILED') {
                return (
                    <div key={msg.id} className="flex flex-col items-end group mb-4">
                        <div className="flex items-center gap-2 max-w-full opacity-70">
                             <div className="p-3 text-sm clip-corner-sm border border-red-500/50 bg-red-900/10 text-red-300">
                                 <div className="flex items-center gap-2 mb-1 text-xs font-bold text-red-500">
                                     <X size={12} />
                                     <span>SEND FAILED</span>
                                 </div>
                                 <div className="opacity-80 line-through decoration-red-500/50">{msg.text}</div>
                                 {msg.error && <div className="text-[10px] text-red-400 mt-1 font-mono">Error: {msg.error}</div>}
                             </div>
                        </div>
                        <div className="flex gap-2 mt-1 px-1">
                            <button 
                                onClick={() => onRetryMessage(activeSessionId!, msg.id)} 
                                className="text-[10px] flex items-center gap-1 text-red-400 hover:text-white border border-red-800 bg-red-900/20 px-2 py-1 clip-corner-sm transition-colors"
                            >
                                <RefreshCw size={10} /> RETRY
                            </button>
                            <button 
                                onClick={() => handleDeleteMessage(msg.id)} 
                                className="text-[10px] flex items-center gap-1 text-gray-500 hover:text-red-400 border border-gray-800 bg-gray-900/50 px-2 py-1 clip-corner-sm transition-colors"
                            >
                                <Trash2 size={10} /> DELETE
                            </button>
                        </div>
                    </div>
                );
            }

            const thinkingExpanded = expandedThinkings.has(msg.id);
            const setThinkingExpanded = (expanded: boolean) => {
                setExpandedThinkings(prev => {
                    const next = new Set(prev);
                    if (expanded) next.add(msg.id);
                    else next.delete(msg.id);
                    return next;
                });
            };
            const hasThinking = msg.role === 'model' && msg.reasoning && msg.reasoning.trim().length > 0;

            return (
                <div key={msg.id} onClick={() => toggleMessageSelection(msg.id)} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group ${isSelectionMode ? 'cursor-pointer' : ''}`}>
                    {/* 思考过程 (DeepSeek V4 Pro reasoning_content) - 可展开/收起 */}
                    {hasThinking && (
                        <div className="max-w-full mb-1" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={() => setThinkingExpanded(!thinkingExpanded)}
                                className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-300 font-mono transition-colors pl-1"
                            >
                                <span className={thinkingExpanded ? 'rotate-90 transition-transform' : 'transition-transform'}>▶</span>
                                <span>{thinkingExpanded ? '收起内心独白' : '💭 内心独白'}</span>
                            </button>
                            {thinkingExpanded && (
                                <div className="mt-1 p-3 text-xs text-gray-400/80 bg-gray-900/60 border-l-2 border-purple-500/30 rounded-r clip-corner-sm italic leading-relaxed max-w-full overflow-hidden" style={{ textRendering: 'optimizeLegibility' }}>
                                    <MarkdownText text={msg.reasoning!} highlightColor="text-purple-400/70" />
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-2 max-w-full">
                        {isSelectionMode && (
                             <div className={`shrink-0 w-4 h-4 border rounded-sm flex items-center justify-center transition-colors ${isSelected ? 'border-yellow-500 bg-yellow-900/50' : 'border-gray-700 bg-black'}`}>
                                 {isSelected && <Check size={10} className="text-yellow-500" />}
                             </div>
                        )}
                        <div className={`p-3 text-sm clip-corner-sm shadow-[0_0_10px_rgba(0,0,0,0.5)] transition-opacity ${isSelectionMode && !isSelected ? 'opacity-50' : 'opacity-100'} ${msg.role === 'user' ? 'bg-gray-800 text-gray-200 border-r-2 border-gray-600' : 'bg-blue-900/20 text-blue-100 border-l-2 border-blue-500'}`}>
                            {isEditing ? (
                                <div className="flex flex-col gap-2 min-w-[200px]" onClick={(e) => e.stopPropagation()}>
                                    <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="bg-black/50 text-white border border-blue-500/50 p-2 text-xs font-mono w-full h-24 focus:outline-none focus:border-blue-400" />
                                    <div className="flex justify-end gap-2">
                                        <button onClick={handleCancelEdit} className="text-gray-400 hover:text-white"><X size={14} /></button>
                                        <button onClick={handleSaveEdit} className="text-green-400 hover:text-green-300"><Check size={14} /></button>
                                    </div>
                                </div>
                            ) : (
                                <MarkdownText text={msg.text} highlightColor={msg.role === 'user' ? 'text-white' : 'text-blue-400'}/>
                            )}
                        </div>
                    </div>
                    <div className={`text-[10px] text-gray-500/80 mt-1 px-2 font-mono flex items-center gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        <span>{new Date(msg.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        {!isEditing && !isSelectionMode && !isTransient && (
                            <div className={`${isLastActionableMessage ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity flex gap-2`}>
                                <button onClick={() => handleStartEdit(msg)} className="hover:text-blue-400 transition-colors" title="编辑消息"><Edit2 size={10} /></button>
                                <button onClick={() => handleDeleteMessage(msg.id)} className="hover:text-red-500 transition-colors" title="删除消息"><Trash2 size={10} /></button>
                                {isLastActionableMessage && msg.role === 'model' && (
                                    <button onClick={handleRegenerate} className="hover:text-green-400 transition-colors" title="重新生成回复"><RefreshCw size={10} /></button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            );
        })}
        {isProcessing && !messages.some(m => m.transientType === 'streaming' || m.transientType === 'tool_status') && !messages.some(m => m.text.includes('[SYSTEM:')) && (<div className="flex justify-start"><div className="text-blue-500 text-xs animate-pulse font-mono pl-2">Thinking...</div></div>)}
      </div>

      <div className="p-4 border-t border-gray-800 bg-black shrink-0">
         {isSelectionMode ? (
             <div className="flex justify-between items-center h-10 animate-[fadeIn_0.2s]">
                 <span className="text-xs text-yellow-500 font-mono">SELECTED: {selectedMsgIds.size}</span>
                 <div className="flex gap-2">
                     <button onClick={() => handleArchiveSelected('RAW')} disabled={selectedMsgIds.size === 0 || isSummarizing} className="px-3 py-2 bg-gray-800 text-gray-300 text-xs font-bold border border-gray-600 hover:bg-gray-700 hover:text-white disabled:opacity-50 clip-corner-sm">原样摘录</button>
                     <button onClick={() => handleArchiveSelected('SUMMARIZE')} disabled={selectedMsgIds.size === 0 || isSummarizing} className="px-3 py-2 bg-yellow-900/50 text-yellow-400 text-xs font-bold border border-yellow-700 hover:bg-yellow-800 hover:text-white disabled:opacity-50 clip-corner-sm flex items-center gap-2">{isSummarizing && <div className="animate-spin w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full"/>}AI 总结归档</button>
                 </div>
             </div>
         ) : (
             <>
                  <div className="flex justify-between text-[10px] text-gray-500 mb-2"><span>REMAINING_TURNS: {unlockedTurns}</span>{unlockedTurns <= 0 && <span className="text-red-500">CREDITS REQUIRED</span>}</div>
                  <div className="flex gap-2 items-end">
                      <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} disabled={unlockedTurns <= 0 || isProcessing} placeholder={unlockedTurns > 0 ? "输入讯息..." : "请先在商店解锁通讯模块"} className="flex-1 bg-gray-900 border border-gray-700 text-white p-2 text-sm focus:border-blue-500 outline-none clip-corner-sm resize-none max-h-32" rows={1}/>
                      {isProcessing && canStopGeneration ? (
                          <button
                              onClick={onStopGeneration}
                              className="bg-red-900/50 text-red-300 px-4 py-2 text-xs font-bold border border-red-700 hover:bg-red-800 hover:text-white clip-corner-sm h-10"
                          >
                              STOP
                          </button>
                      ) : (
                          <button onClick={handleSend} disabled={unlockedTurns <= 0 || isProcessing || !input.trim()} className="bg-blue-900/50 text-blue-400 px-4 py-2 text-xs font-bold border border-blue-700 hover:bg-blue-800 hover:text-white disabled:opacity-50 clip-corner-sm h-10">SEND</button>
                      )}
                  </div>
               </>
           )}
        </div>

      {isManualMemoryOpen && (
          <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-sm border border-gray-600 bg-[#111] p-1 clip-corner shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                  <div className="bg-gray-900/20 p-4 border border-gray-800 flex flex-col">
                      <div className="flex justify-between items-center mb-4">
                          <h3 className="text-gray-300 font-bold font-[Orbitron] tracking-widest">MANUAL_MEMORY</h3>
                          <button onClick={onCloseManualMemory} className="text-gray-500 hover:text-white">CANCEL</button>
                      </div>
                      <form onSubmit={handleManualMemorySubmit} className="flex flex-col gap-4">
                          <textarea value={manualMemoryContent} onChange={(e) => setManualMemoryContent(e.target.value)} placeholder="在此输入需要永久保存的记忆或笔记..." className="w-full h-32 bg-black border border-gray-700 text-gray-300 p-2 text-sm font-mono focus:border-gray-500 outline-none resize-none placeholder-gray-800" autoFocus />
                          <button type="submit" className="bg-gray-700 text-white font-bold py-3 uppercase tracking-widest hover:bg-gray-600 clip-corner-sm">SAVE TO MEMORY BANK</button>
                      </form>
                  </div>
              </div>
          </div>
      )}
      
      {isMemoryBankOpen && (
          <MemoryBankModal 
            memories={config ? memoryBank : []} 
            onClose={onCloseMemoryBank}
            onDelete={onDeleteMemory} 
            onUpdate={onUpdateMemory}
            onToggleEnabled={onToggleMemoryEnabled}
          />
      )}
    </div>
  );
};

export default ChatInterface;
