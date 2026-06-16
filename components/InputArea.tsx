import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic } from 'lucide-react';

interface InputAreaProps {
  onSend: (text: string) => void;
  isLoading: boolean;
}

export const InputArea: React.FC<InputAreaProps> = ({ onSend, isLoading }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (input.trim() && !isLoading) {
      onSend(input);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  return (
    <div className="w-full bg-[#18181b] border-t border-gray-800 p-4">
      <div className="max-w-3xl mx-auto relative flex items-end gap-2 bg-[#27272a] p-2 rounded-xl border border-gray-700 focus-within:border-primary-500 transition-colors">
        <button 
          className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
          title="Voice Input (Coming Soon)"
        >
          <Mic size={20} />
        </button>
        
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message to Aura..."
          className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none outline-none max-h-32 py-2"
          rows={1}
          disabled={isLoading}
        />

        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className={`p-2 rounded-lg transition-all duration-200 ${
            input.trim() && !isLoading
              ? 'bg-primary-600 text-white hover:bg-primary-500 shadow-lg'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          <Send size={20} />
        </button>
      </div>
      <div className="text-center mt-2">
         <p className="text-xs text-gray-600">AI can make mistakes. Please double-check important information.</p>
      </div>
    </div>
  );
};