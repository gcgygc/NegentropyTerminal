
import React, { useState } from 'react';
import { NotificationLog } from '../types';
import { Mail, Trash2, Check, Star } from 'lucide-react';

interface NotificationInboxProps {
  notifications: NotificationLog[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onToggleBookmark: (id: string) => void;
}

const NotificationInbox: React.FC<NotificationInboxProps> = ({ notifications, onClose, onDelete, onClearAll, onToggleBookmark }) => {
  const [filter, setFilter] = useState<'ALL' | 'BOOKMARKS'>('ALL');

  const filteredNotifications = notifications.filter(n => filter === 'ALL' || n.isBookmarked);

  const formatNotificationTimestamp = (timestamp: number): string => {
    const value = new Date(timestamp);
    const now = new Date();
    const isSameYear = value.getFullYear() === now.getFullYear();
    const isSameDay = isSameYear
      && value.getMonth() === now.getMonth()
      && value.getDate() === now.getDate();

    if (isSameDay) {
      return value.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }

    if (isSameYear) {
      return value.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace(',', '');
    }

    return value.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).replace(',', '');
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-[fadeIn_0.2s]">
      <div className="w-full max-w-md h-[80vh] flex flex-col bg-[#050505] border border-green-900/50 shadow-[0_0_50px_rgba(0,50,0,0.5)] clip-corner">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-3 sm:items-center sm:p-4 border-b border-green-900/30 bg-green-950/20 shrink-0">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex items-center gap-2 min-w-0">
                    <Mail size={16} className="text-green-500 animate-pulse shrink-0" />
                    <h3 className="text-green-500 font-bold font-[Orbitron] tracking-widest text-xs sm:text-sm truncate">INBOX</h3>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                    <button 
                        onClick={() => setFilter('ALL')} 
                        className={`px-2 py-1 border ${filter === 'ALL' ? 'border-green-500 text-green-400 bg-green-900/20' : 'border-gray-800 text-gray-500 hover:text-green-500'}`}
                    >
                        ALL
                    </button>
                    <button 
                        onClick={() => setFilter('BOOKMARKS')} 
                        className={`px-2 py-1 border flex items-center gap-1 ${filter === 'BOOKMARKS' ? 'border-yellow-500 text-yellow-400 bg-yellow-900/20' : 'border-gray-800 text-gray-500 hover:text-yellow-500'}`}
                    >
                        <Star size={10} className={filter === 'BOOKMARKS' ? 'fill-yellow-400' : ''} />
                        SAVED
                    </button>
                </div>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white font-mono text-[10px] sm:text-xs shrink-0 whitespace-nowrap">
                <span className="sm:hidden">[X]</span>
                <span className="hidden sm:inline">[CLOSE]</span>
            </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {filteredNotifications.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-700 font-mono text-xs space-y-2">
                    <Check size={24} className="opacity-20" />
                    <span>{filter === 'ALL' ? 'BUFFER_EMPTY // NO_NEW_MESSAGES' : 'NO_SAVED_MESSAGES'}</span>
                </div>
            )}
            
            {filteredNotifications.map(notif => (
                <div key={notif.id} className="relative bg-[#0a0a0a] border-l-2 border-green-800 p-3 group hover:bg-green-900/10 transition-colors">
                    <div className="mb-2 flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 text-[10px] text-green-700 font-bold uppercase tracking-wider font-[Orbitron] break-words">{notif.title}</span>
                        <span className="shrink-0 text-[10px] text-gray-600 font-mono">{formatNotificationTimestamp(notif.timestamp)}</span>
                    </div>
                    
                    <div className="mb-3 border-l border-gray-800 pl-2 ml-1 text-[11px] sm:text-xs text-gray-300 font-mono leading-relaxed opacity-90 whitespace-pre-wrap">
                        {notif.content}
                    </div>
                    
                    <div className="flex items-center justify-between gap-2">
                        <button 
                            onClick={() => onToggleBookmark(notif.id)}
                            className={`p-1.5 border transition-colors ${notif.isBookmarked ? 'border-yellow-500/50 text-yellow-400 bg-yellow-900/20' : 'border-gray-800 text-gray-600 hover:text-yellow-500 hover:border-yellow-900/50'}`}
                            title={notif.isBookmarked ? "Unsave" : "Save"}
                        >
                            <Star size={12} className={notif.isBookmarked ? 'fill-yellow-400' : ''} />
                        </button>
                        <button 
                            onClick={() => onDelete(notif.id)}
                            className="flex items-center gap-1 text-[10px] bg-green-900/20 text-green-400 px-2 py-1 border border-green-800/50 hover:bg-green-800 hover:text-white transition-colors clip-corner-sm whitespace-nowrap shrink-0"
                        >
                            <Check size={10} />
                            <span className="sm:hidden">ACK</span>
                            <span className="hidden sm:inline">ACKNOWLEDGE</span>
                        </button>
                    </div>
                </div>
            ))}
        </div>

        {/* Footer */}
        {filteredNotifications.length > 0 && filter === 'ALL' && (
            <div className="p-3 border-t border-green-900/30 bg-[#0a0a0a]">
                <button 
                    onClick={onClearAll}
                    className="w-full py-3 flex items-center justify-center gap-2 text-red-500/70 border border-red-900/30 hover:bg-red-950/30 hover:text-red-400 hover:border-red-800 transition-all clip-corner-sm font-bold text-[10px] sm:text-xs tracking-widest"
                >
                    <Trash2 size={12} />
                    <span className="sm:hidden">CLEAR BUFFER</span>
                    <span className="hidden sm:inline">FLUSH_BUFFER (CLEAR UNBOOKMARKED)</span>
                </button>
            </div>
        )}
      </div>
    </div>
  );
};

export default NotificationInbox;
