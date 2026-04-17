"use client";
import React from 'react';
import AgentList from '@/components/AgentList';
import useWebSocket from '@/hooks/useWebSocket';
import { useAuth } from '@/context/AuthContext';

const WS_URL = typeof window !== 'undefined' ? (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.hostname.replace(/:\d+$/, ':5000') : '';

export default function AgentsPage() {
  //const { token } = useAuth();
  const wsToken = typeof window !== 'undefined' ? (localStorage.getItem('token') || '') : '';
  const { parsedMessages } = useWebSocket(WS_URL, wsToken);

  const agents = parsedMessages
    .filter((msg: any) => msg && (msg.type === 'agent:status' || msg.type === 'agentfi:agents'))
    .flatMap((msg: any) => msg.data?.agents || msg.agents || []);

  return (
    <div className="min-h-screen bg-gray-950 py-10 px-4">
      <h1 className="text-3xl font-bold text-white mb-8">Agent Status Dashboard</h1>
      <AgentList agents={agents || []} />
    </div>
  );
}
