"use client";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useWebSocket as useWebSocketHook } from "../hooks/useWebSocket";

const WebSocketContext = createContext<any>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const socket = useWebSocketHook();
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    if (!socket.parsedMessages.length) return;
    setEvents(socket.parsedMessages);
  }, [socket.parsedMessages]);

  const value = useMemo(() => ({
    events,
    agents: [],
    tasks: [],
    connectionStatus: socket.connectionStatus,
    parsedMessages: socket.parsedMessages,
    forceSync: async () => {},
    dispatchTestTask: async () => {},
    sendMessage: () => {},
  }), [events, socket.connectionStatus, socket.parsedMessages]);

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocketContext() {
  return useContext(WebSocketContext);
}

export function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  return {
    sendMessage: ctx?.sendMessage || (() => {}),
    parsedMessages: ctx?.parsedMessages || [],
    connectionStatus: ctx?.connectionStatus || "offline",
  };
}
