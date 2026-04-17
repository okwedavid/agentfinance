import React from 'react';
import AgentCard from './AgentCard';
import type { Agent } from './AgentCard';

interface AgentListProps {
  agents: Agent[];
}

const AgentList: React.FC<AgentListProps> = ({ agents }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {agents.map(agent => (
      <AgentCard key={agent.id} agent={agent} />
    ))}
  </div>
);

export default AgentList;
