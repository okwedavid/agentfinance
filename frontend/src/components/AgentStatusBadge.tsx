import React from 'react';

export type AgentStatus = 'online' | 'offline' | 'idle' | 'busy' | 'paused';

interface AgentStatusBadgeProps {
  status: AgentStatus;
}

const statusColors: Record<AgentStatus, string> = {
  online: 'bg-green-500',
  offline: 'bg-red-500',
  idle: 'bg-yellow-400',
  busy: 'bg-blue-500',
  paused: 'bg-gray-500',
};

const statusLabels: Record<AgentStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  idle: 'Idle',
  busy: 'Busy',
  paused: 'Paused',
};

const AgentStatusBadge: React.FC<AgentStatusBadgeProps> = ({ status }) => (
  <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold text-white ${statusColors[status]}`}
    title={statusLabels[status]}
  >
    <span className={`w-2 h-2 rounded-full ${statusColors[status]}`}></span>
    {statusLabels[status]}
  </span>
);

export default AgentStatusBadge;
