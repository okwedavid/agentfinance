import { apiFetch } from '../lib/api';
import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import useWsHook from "../hooks/useWebSocket";
const WebSocketContext = createContext(null);
export function WebSocketProvider({ children }) {
  const { parsedMessages, connectionStatus, sendMessage } = useWsHook(process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:5000");
  const [agents, setAgents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  useEffect(() => {
    parsedMessages.forEach((msg) => {
      if (msg.type === "agent:update") setAgents((prev) => [...prev.filter(a => a.agentId !== msg.agentId), { ...msg.payload, agentId: msg.agentId }]);
      if (msg.type === "task:progress" || msg.type === "worker:result") setTasks((prev) => [...prev, msg.payload]);
      setEvents((prev) => [...prev, msg]);
    });
  }, [parsedMessages]);
  const forceSync = async () => {
    const data = await apiFetch('/coord/summary');
    setAgents(data.agents);
    setTasks(data.tasks);
  };
  const dispatchTestTask = async () => {
    await apiFetch('/coord/dispatch', { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: agents[0]?.agentId, action: "test", payload: {} }) });
  };
  return (
    <WebSocketContext.Provider value={{ events, agents, tasks, connectionStatus, forceSync, dispatchTestTask, sendMessage }}>
      {children}
    </WebSocketContext.Provider>
  );
}
export function useWebSocketContext() {
  return useContext(WebSocketContext);
}

// helper named export expected by some components: useWebSocket()
export function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  return {
    sendMessage: ctx?.sendMessage || (() => {}),
    parsedMessages: ctx?.events || [],
    connectionStatus: ctx?.connectionStatus || 'unknown',
  };
}
