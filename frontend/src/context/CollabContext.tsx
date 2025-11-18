"use client";
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { WS_URL } from '@/lib/env';

const CollabContext = createContext<any>(null);

export function CollabProvider({ children }: { children: React.ReactNode }) {
  const [participants, setParticipants] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL.replace('http', 'ws'));
    wsRef.current = ws;
    ws.onopen = () => console.log('collab ws open');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'participants') setParticipants(msg.count || 0);
      } catch (e) {}
    };
    ws.onclose = () => console.log('collab ws closed');
    return () => ws.close();
  }, []);

  const join = (sessionId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'join', sessionId }));
    }
  };

  return <CollabContext.Provider value={{ participants, join }}>{children}</CollabContext.Provider>;
}

export const useCollab = () => {
  return useContext(CollabContext);
};
