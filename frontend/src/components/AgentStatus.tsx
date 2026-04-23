"use client";
import React, { useEffect, useState } from 'react';
import { getToken } from '@/lib/api';
import { useAuth } from '../context/AuthContext';
export default function AgentStatus() {
  const [online, setOnline] = useState<number>(0);
  const [names, setNames] = useState<string[]>([]);
  const [lastMessage, setLastMessage] = useState<string>(""); // For the live text feed

  const authCtx = useAuth();
  const token = getToken() || authCtx?.token;
  

  // Requirement 2: Text Processing Utility
  const processAgentText = (text: string) => {
    if (!text) return "Synchronizing with decentralized nodes...";
    
    // 1. Regex-strip all # and * characters
    let cleaned = text.replace(/[#*]/g, '');

    // 2. Identify "Key Words" (WORD:) and wrap them for styling
    const parts = cleaned.split(/([A-Z\s]{2,}:)/g);

    return parts.map((part, index) => {
      if (/[A-Z\s]{2,}:/.test(part)) {
        return <span key={index} className="text-[#60a5fa] font-bold uppercase text-[9px] mr-1">{part}</span>;
      }
      return part;
    });
  };

  useEffect(() => {
    if (!token || typeof window === 'undefined') return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}${window.location.port ? ':5000' : ''}/?token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'presence:update') {
          setOnline(msg.count || 0);
          setNames(msg.agents || []);
        }
        // Capture live response content if available in your message schema
        if (msg.content) {
          setLastMessage(msg.content);
        }
      } catch (e) { /* ignore */ }
    };
    
    return () => ws.close();
  }, [token]);

  return (
    <div className="fixed top-0 left-0 w-full z-[60] bg-[#0f172a]/90 backdrop-blur-md border-b border-green-500/30 px-4 py-2 shadow-2xl">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        
        {/* Left Side: Brand & Pulse */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="relative h-2 w-2">
            <span className="animate-ping absolute h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative block rounded-full h-2 w-2 bg-green-500"></span>
          </div>
          <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest font-mono">
            Feed
          </span>
        </div>

        {/* Center: The Cleaned Response UI */}
        <div className="flex-1 mx-6 overflow-hidden">
          <div className="font-mono text-[11px] leading-relaxed text-gray-300 truncate whitespace-nowrap">
            {processAgentText(lastMessage || (names.length > 0 ? `ACTIVE AGENTS: ${names.join(', ')}` : ""))}
          </div>
        </div>

        {/* Right Side: Online Count */}
        <div className="flex items-center space-x-2 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded shrink-0">
          <span className="text-[10px] font-bold text-green-400">{online}</span>
          <span className="text-[9px] text-green-500/70 uppercase font-bold tracking-tighter">Agents</span>
        </div>

      </div>
    </div>
  );
}
