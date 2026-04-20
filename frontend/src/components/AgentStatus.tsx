"use client";
import React, { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

export default function AgentStatus() {
  const [online, setOnline] = useState<number>(0);
  const [names, setNames] = useState<string[]>([]);
   // Use 'any' type assertion to bypass the strict AuthContextType check for the build
  const context = useContext(AuthContext) as any;
  const token = context?.token; 

  useEffect(() => {
    // Ensure we have a token and we are in the browser
    if (!token || typeof window === 'undefined') return;

    // Fix for Railway: Use wss if the site is on https
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Use the backend port 5000 or your production WebSocket URL
    const wsUrl = `${protocol}//${window.location.hostname}${window.location.port ? ':5000' : ''}/?token=${token}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'presence:update') {
          setOnline(msg.count || 0);
          setNames(msg.agents || []);
        }
      } catch (e) {
        // ignore
      }
    };
    ws.onopen = () => console.debug('AgentStatus WS connected');
    ws.onerror = (e) => console.warn('AgentStatus WS error', e);
    return () => ws.close();
  }, [token]);

  // If no one is online, we still show the bar but in a "searching" state
  return (
    <div className="fixed top-0 left-0 w-full z-[60] bg-black/80 backdrop-blur-md border-b border-green-500/30 px-4 py-2 shadow-2xl">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        
        {/* Left Side: Pulse & Status */}
        <div className="flex items-center space-x-3">
          <div className="relative flex items-center justify-center h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </div>
          <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest font-mono">
            Live Agent Feed
          </span>
        </div>

        {/* Center: The Active Agents Names */}
        <div className="hidden md:block text-[11px] font-mono text-gray-400 truncate max-w-xl">
          {names.length > 0 
            ? `Active: ${names.join(', ')}` 
            : "Synchronizing with decentralized nodes..."}
        </div>

        {/* Right Side: Online Count Badge */}
        <div className="flex items-center space-x-2 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded">
          <span className="text-[10px] font-bold text-green-400">{online}</span>
          <span className="text-[9px] text-green-500/70 uppercase font-bold">Agents</span>
        </div>

      </div>
    </div>
  );
}
