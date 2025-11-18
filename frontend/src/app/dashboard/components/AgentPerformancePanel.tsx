import React from "react";

interface AgentPerformance {
  id: string;
  status: "online" | "offline";
  tasksHandled: number;
  uptime: number; // seconds
}

interface AgentPerformancePanelProps {
  agents: AgentPerformance[];
}

const statusColor = {
  online: "bg-emerald-500",
  offline: "bg-gray-500",
};

export const AgentPerformancePanel: React.FC<AgentPerformancePanelProps> = ({ agents }) => (
  <div className="rounded-2xl shadow-md bg-gray-900 dark:bg-gray-800 p-4">
    <h3 className="text-lg font-semibold text-gray-200 mb-2">Agent Performance</h3>
    <div className="flex flex-col gap-3">
      {agents.map((agent) => (
        <div key={agent.id} className="flex items-center gap-4 p-2 rounded-lg bg-gray-800">
          <span className={`w-3 h-3 rounded-full ${statusColor[agent.status]} animate-pulse`} />
          <span className="font-medium text-gray-100">{agent.id}</span>
          <span className="text-xs text-gray-400">{agent.status}</span>
          <span className="ml-auto text-xs text-gray-400">Tasks: {agent.tasksHandled}</span>
          <span className="ml-2 text-xs text-gray-400">Uptime: {Math.floor(agent.uptime/60)}m</span>
        </div>
      ))}
    </div>
  </div>
);

export default AgentPerformancePanel;
