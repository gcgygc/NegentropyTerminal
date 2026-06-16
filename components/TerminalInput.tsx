import React, { useState } from 'react';

interface TerminalInputProps {
  onSubmit: (text: string) => Promise<void>;
  isProcessing: boolean;
}

const TerminalInput: React.FC<TerminalInputProps> = ({ onSubmit, isProcessing }) => {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    onSubmit(input);
    setInput('');
  };

  return (
    <div className="w-full relative group">
      {/* 装饰性背景框 */}
      <div className="absolute -inset-0.5 bg-gradient-to-r from-green-900 to-green-600 rounded opacity-20 blur transition duration-200 group-hover:opacity-40"></div>
      
      <div className="relative bg-black border border-green-800 clip-corner p-1">
        {/* 终端头部 */}
        <div className="flex justify-between items-center bg-green-900/20 px-2 py-1 mb-1 border-b border-green-900/50">
           <div className="flex items-center space-x-2">
             <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
             <span className="text-[10px] sm:text-xs text-green-400 font-bold tracking-widest">SECURE_LINK::ESTABLISHED</span>
           </div>
           <div className="text-[10px] text-green-600 hidden sm:block">PID: {Math.floor(Math.random() * 9000) + 1000}</div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder=">>> 初始化思维上传..."
            className="w-full h-32 bg-[#050505] text-green-400 p-3 font-mono text-sm border-none focus:ring-0 focus:outline-none resize-none placeholder-green-900"
            disabled={isProcessing}
            style={{ fontFamily: "'Share Tech Mono', monospace" }}
          />
          
          {/* 右下角装饰 */}
          <div className="absolute bottom-12 right-2 pointer-events-none opacity-30">
             <svg width="40" height="40" viewBox="0 0 100 100" fill="none" stroke="currentColor" className="text-green-500">
                <path d="M 10 90 L 90 90 L 90 10" strokeWidth="1" strokeDasharray="4 4"/>
             </svg>
          </div>

          <div className="flex justify-between items-center mt-2 px-2 pb-2 gap-3">
              <div className="flex flex-col text-[10px] sm:text-xs text-gray-500 leading-tight">
                <span>ENCRYPTION: 256-BIT</span>
                <span>LATENCY: 12ms</span>
              </div>
              <button
                type="submit"
                disabled={isProcessing}
                className={`
                  clip-corner-sm px-4 sm:px-6 py-2 
                  font-bold uppercase text-[10px] sm:text-xs tracking-wider transition-all duration-200
                  flex items-center gap-2
                  ${isProcessing 
                    ? 'bg-gray-800 text-gray-500 cursor-wait border border-gray-700' 
                    : 'bg-green-600 text-black hover:bg-green-400 hover:shadow-[0_0_15px_rgba(0,255,65,0.6)] border border-green-400'
                  }
                `}
              >
                {isProcessing ? (
                  <>
                    <span className="animate-spin h-3 w-3 border-2 border-gray-500 border-t-transparent rounded-full"></span>
                    PROCESSING
                  </>
                ) : (
                  <>
                    TRANSMIT
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                  </>
                )}
              </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TerminalInput;
