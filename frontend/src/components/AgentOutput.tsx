import React from 'react';

export const AgentOutput = ({ data }) => {
  if (!data) return null;
  return (
    <div className="fixed top-0 left-0 w-full z-[100] bg-black/80 backdrop-blur-xl border-b border-cyan-500/50 p-4 shadow-[0_0_20px_rgba(0,255,255,0.2)]">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-[0.2em]">Agent Intelligence Feed</span>
        </div>
        <div className="text-sm font-mono text-gray-100 truncate max-w-3xl">
          {typeof data === 'string' ? data : JSON.stringify(data)}
        </div>
      </div>
    </div>
  );
};
