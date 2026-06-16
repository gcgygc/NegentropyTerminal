

import React, { useState } from 'react';
import { MemoryLog } from '../types';
import MarkdownText from './MarkdownText';
import { Trash2, Search, Edit2, X, Check, Eye, EyeOff } from 'lucide-react';

interface MemoryBankModalProps {
  memories: MemoryLog[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, newContent: string) => void;
  onToggleEnabled: (id: string) => void;
  onClose: () => void;
}

export const MemoryBankModal: React.FC<MemoryBankModalProps> = ({ memories, onDelete, onUpdate, onToggleEnabled, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const filteredMemories = memories.filter(m => 
    m.content.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
  ).sort((a,b) => b.timestamp - a.timestamp);

  const startEditing = (memory: MemoryLog) => {
    setEditingMemoryId(memory.id);
    setEditText(memory.content);
  };

  const cancelEditing = () => {
    setEditingMemoryId(null);
    setEditText('');
  };

  const saveEdit = () => {
    if (editingMemoryId) {
      onUpdate(editingMemoryId, editText);
      cancelEditing();
    }
  };


  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.2s]">
      <div className="w-full max-w-lg h-[85vh] sm:h-[80vh] flex flex-col bg-[#0a0a0a] border border-blue-900/50 shadow-[0_0_50px_rgba(0,0,50,0.5)] clip-corner">
        
        {/* Header */}
        <div className="flex justify-between items-center p-3 sm:p-4 border-b border-blue-900/30 bg-blue-950/20">
            <div className="flex items-center gap-2 overflow-hidden">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse shrink-0"></div>
                <h3 className="text-blue-400 font-bold font-[Orbitron] tracking-widest text-sm md:text-lg truncate">GLOBAL_MEMORY_CORE</h3>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white font-mono text-xs shrink-0 ml-4">[CLOSE]</button>
        </div>

        {/* Search */}
        <div className="p-3 sm:p-4 border-b border-gray-800">
            <div className="relative">
                <input 
                    type="text" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search memories via keywords or tags..."
                    className="w-full bg-[#111] border border-gray-700 text-blue-100 p-2 pl-9 text-xs focus:border-blue-500 outline-none clip-corner-sm placeholder-blue-900/50 font-mono"
                />
                <Search className="w-4 h-4 text-blue-800 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 custom-scrollbar">
            {filteredMemories.length === 0 && (
                <div className="text-center mt-20 text-gray-700 font-mono text-xs">
                    {memories.length === 0 ? "MEMORY_BANKS_EMPTY" : "NO_MATCHING_DATA"}
                </div>
            )}
            
            {filteredMemories.map(memory => {
                const isEditing = editingMemoryId === memory.id;
                return (
                <div key={memory.id} className="group relative bg-[#0e0e10] p-3 sm:p-4 border border-gray-800 hover:border-blue-500/50 transition-all clip-corner-sm">
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-900/30 group-hover:bg-blue-500 transition-colors"></div>
                    
                    <div className="flex flex-col gap-2 mb-3 pl-2 sm:flex-row sm:justify-between sm:items-start">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="text-[10px] sm:text-xs text-gray-500 font-mono">
                                {new Date(memory.timestamp).toLocaleDateString()}
                            </span>
                            {memory.tags.map(tag => (
                                <span key={tag} className="text-[10px] bg-blue-900/20 text-blue-300 px-1.5 py-0.5 border border-blue-900/50 rounded-sm">
                                    {tag}
                                </span>
                            ))}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-0 sm:ml-2 self-end sm:self-auto">
                            <button 
                                onClick={() => onToggleEnabled(memory.id)}
                                className={`${memory.enabled !== false ? 'text-blue-400' : 'text-gray-600'} hover:text-white transition-colors`}
                                title={memory.enabled !== false ? "AI 可见" : "AI 不可见"}
                            >
                                {memory.enabled !== false ? <Eye size={12} /> : <EyeOff size={12} />}
                            </button>
                            <button 
                                onClick={() => startEditing(memory)}
                                className="text-gray-600 hover:text-blue-400 transition-colors"
                                title="Edit Memory"
                            >
                                <Edit2 size={12} />
                            </button>
                            <button 
                                onClick={() => onDelete(memory.id)}
                                className="text-gray-600 hover:text-red-500 transition-colors"
                                title="Delete Memory"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    </div>

                    { isEditing ? (
                        <div className="pl-2">
                            <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="w-full h-24 bg-black border border-blue-800 text-blue-100 p-2 text-xs font-mono focus:border-blue-400 outline-none resize-y placeholder-blue-900/50"
                                autoFocus
                            />
                            <div className="flex justify-end gap-2 mt-2">
                                <button onClick={cancelEditing} className="p-2 text-gray-500 hover:text-white"><X size={14}/></button>
                                <button onClick={saveEdit} className="p-2 text-green-500 hover:text-green-400"><Check size={14}/></button>
                            </div>
                        </div>
                    ) : (
                        <div className="pl-2">
                            <MarkdownText 
                                text={memory.content} 
                                className="text-sm text-gray-300 font-mono leading-relaxed" 
                                highlightColor="text-blue-400"
                            />
                        </div>
                    )}
                    
                    <div className="mt-2 pl-2 flex justify-end">
                        <span className="text-[10px] text-gray-700 uppercase tracking-wider">
                            SOURCE: {memory.source}
                        </span>
                    </div>
                </div>
            )})}
        </div>
      </div>
    </div>
  );
};
