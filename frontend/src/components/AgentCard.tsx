
import React from 'react';
import AgentStatusBadge from './AgentStatusBadge';
import AgentControls from './AgentControls';

export interface Agent {
  id: string;
  name: string;
  host?: string;
  status?: 'online' | 'offline' | 'idle' | 'busy' | 'paused';
  role?: string;
  currentTaskId?: string;
  lastHeartbeat?: string;
  prompt?: string;
}

export interface AgentCardProps {
  agent: Agent;
  onPauseAgent?: (id: string) => void;
  onResumeAgent?: (id: string) => void;
  onTerminateAgent?: (id: string) => void;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent, onPauseAgent, onResumeAgent, onTerminateAgent }) => {
  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl p-6 flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xl font-bold text-white">{agent.name}</h3>
        <AgentStatusBadge status={agent.status || 'offline'} />
      </div>
      {agent.host && <div className="text-gray-300 text-sm">Host: {agent.host}</div>}
      {agent.role && <div className="text-gray-400 text-xs">Role: {agent.role}</div>}
      <div className="text-gray-400 text-xs">Current Task: {agent.currentTaskId || '—'}</div>
      <div className="text-gray-400 text-xs">Last Heartbeat: {agent.lastHeartbeat ? new Date(agent.lastHeartbeat).toLocaleString() : '—'}</div>
      {agent.prompt && <div className="mt-3 text-sm text-gray-200">{agent.prompt.slice(0,200)}</div>}
      <AgentControls
        agentId={agent.id}
        status={agent.status || 'offline'}
        onPause={() => onPauseAgent && onPauseAgent(agent.id)}
        onResume={() => onResumeAgent && onResumeAgent(agent.id)}
        onTerminate={() => onTerminateAgent && onTerminateAgent(agent.id)}
      />
    </div>
  );
};

export default AgentCard;
