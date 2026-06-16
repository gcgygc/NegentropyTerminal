

import React, { useState } from 'react';
import { JournalLog } from '../types';
import MarkdownText from './MarkdownText';
import { RefreshCw } from 'lucide-react';

interface LogArchiveProps {
  logs: JournalLog[];
  onUpdateLog: (id: string, newContent: string) => void;
  onDeleteLog: (id: string) => void;
  onRegenerateLog: (id: string) => void;
  onBack: () => void;
}

const LogArchive: React.FC<LogArchiveProps> = ({ logs, onUpdateLog, onDeleteLog, onRegenerateLog, onBack }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const filteredLogs = logs.filter(log => 
    log.content.toLowerCase().includes(searchTerm.toLowerCase()) || 
    log.aiReply.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.moodTag.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const startEditing = (log: JournalLog) => {
    setEditingLogId(log.id);
    setEditText(log.content);
  };

  const cancelEditing = () => {
    setEditingLogId(null);
    setEditText('');
  };

  const saveEdit = () => {
    if (editingLogId) {
      onUpdateLog(editingLogId, editText);
      cancelEditing();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#050505] absolute inset-0 z-50 overflow-hidden font-mono">
        {/* 头部 */}
        <div className="flex justify-between items-center p-3 sm:p-4 border-b border-gray-800 bg-gray-900/50">
            <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-500 font-bold text-sm tracking-widest">MEMORY_ARCHIVES</span>
            </div>
            <button onClick={onBack} className="text-gray-500 hover:text-white text-xs">[RETURN]</button>
        </div>

        {/* 搜索栏 */}
        <div className="p-3 sm:p-4 border-b border-gray-800 flex gap-2">
            <div className="relative flex-1">
                <input 
                    type="text" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search logs via keywords..."
                    className="w-full bg-gray-900 border border-gray-700 text-white p-2 pl-8 text-xs focus:border-green-500 outline-none clip-corner-sm"
                />
                <svg className="w-4 h-4 text-gray-500 absolute left-2 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>
            <div className="text-[10px] text-gray-600 flex items-center px-2">
                {filteredLogs.length} RECORDS
            </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 custom-scrollbar">
            {filteredLogs.length === 0 && (
                <div className="text-center mt-10 text-gray-600 text-xs">
                    NO_MATCHING_RECORDS_FOUND
                </div>
            )}
            {filteredLogs.map(log => (
                <div key={log.id} className="relative bg-[#0a0a0a] p-3 sm:p-4 border border-green-900/30 hover:border-green-500/50 transition-colors group clip-corner-sm">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-900 group-hover:bg-green-500 transition-colors"></div>
                    <div className="flex flex-col gap-2 mb-2 pl-2 sm:flex-row sm:justify-between sm:items-start">
                        <div className="text-[10px] sm:text-xs text-gray-500 font-mono">
                            {new Date(log.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="text-[10px] text-green-800 bg-green-900/20 px-2 rounded-sm border border-green-900/30">TAG: {log.moodTag}</div>
                            {/* 编辑与删除按钮 */}
                            <div className="flex flex-wrap gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <button onClick={() => startEditing(log)} className="text-[10px] text-yellow-500 hover:text-white">[EDIT]</button>
                                <button onClick={() => onRegenerateLog(log.id)} className="text-[10px] text-cyan-500 hover:text-white">[REGEN]</button>
                                <button onClick={() => onDeleteLog(log.id)} className="text-[10px] text-red-600 hover:text-red-400">[DELETE]</button>
                            </div>
                        </div>
                    </div>
                    {editingLogId === log.id ? (
                        <div className="pl-2">
                            <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="w-full h-24 bg-black border border-green-800 text-green-100 p-2 text-sm font-mono focus:border-green-400 outline-none resize-none placeholder-green-900/50"
                                autoFocus
                            />
                            <div className="flex justify-end gap-2 mt-2">
                                <button onClick={cancelEditing} className="text-xs text-gray-500 hover:text-white px-2 py-1">Cancel</button>
                                <button onClick={saveEdit} className="text-xs bg-green-800 text-white px-3 py-1 hover:bg-green-700">Save</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* 关键修改：添加 whitespace-pre-wrap 样式 */}
                            <div className="pl-2 text-sm text-gray-300 font-light mb-3 leading-relaxed opacity-90 whitespace-pre-wrap">{log.content}</div>
                            <div className="pl-2 pt-3 border-t border-gray-900 flex flex-col gap-1">
                                <div className="flex items-start gap-2">
                                    <span className="text-green-600 mt-1">›</span>
                                    <MarkdownText text={log.aiReply} className="text-green-500 text-xs font-mono" />
                                </div>
                                <div className="self-end text-yellow-600 text-[10px] font-mono border border-yellow-900/30 px-1 mt-1">
                                    +{log.coinsEarned} CR
                                </div>
                            </div>
                        </>
                    )}
                </div>
            ))}
        </div>
    </div>
  );
};

export default LogArchive;
