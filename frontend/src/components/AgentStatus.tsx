"use client";
import React, { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

export default function AgentStatus() {
  const [online, setOnline] = useState<number>(0);
  const [names, setNames] = useState<string[]>([]);
  const  token: any  = useContext(AuthContext);

  useEffect(() => {
    if (!token) return;
    const wsUrl = `ws://${location.hostname}:5000/?token=${token}`;
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

  return (
    <div className="flex items-center space-x-3">
      <span className="inline-flex items-center px-3 py-1 rounded-full bg-green-500/20">
        <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse mr-2" />
        <strong>{online}</strong>
      </span>
      <div className="text-sm text-gray-300">{names.slice(0,3).join(', ')}{names.length>3?` +${names.length-3}`:''}</div>
    </div>
  );
}
