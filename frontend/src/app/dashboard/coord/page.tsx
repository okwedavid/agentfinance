"use client";
import React, { useEffect, useState } from "react";
import AgentCard from "../../../components/AgentCard";
import TaskFlowChart from "../../../components/TaskFlowChart";
import LiveFeed from "../../../components/LiveFeed";
import { useWebSocketContext } from "../../../context/WebSocketContext";
import { motion } from "framer-motion";

const CoordinatorControlRoom = () => {
  const { events, agents, tasks, connectionStatus, forceSync, dispatchTestTask } = useWebSocketContext();
  const [selectedAgent, setSelectedAgent] = useState(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-gray-900 p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white">Coordinator Control Room</h1>
        <span className={`px-2 py-1 rounded text-xs font-semibold ${connectionStatus === 'connected' ? 'bg-emerald-600 animate-pulse' : 'bg-gray-600'} text-white`}>{connectionStatus === 'connected' ? 'Live' : 'Disconnected'}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        <motion.div layout className="col-span-1">
          <AgentCard agents = {agents} onSelect={setSelectedAgent} />
        </motion.div>
        <motion.div layout className="col-span-2">
          <TaskFlowChart tasks={tasks} />
        </motion.div>
        <motion.div layout className="col-span-1">
          <LiveFeed events={events} />
        </motion.div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-900 rounded-2xl p-6 shadow">
          <h2 className="text-lg font-semibold text-white mb-2">Performance Metrics</h2>
          <div className="flex gap-4">
            <div>Agents: <span className="font-bold text-emerald-400">{agents.length}</span></div>
            <div>Tasks: <span className="font-bold text-blue-400">{tasks.length}</span></div>
            <div>Failures: <span className="font-bold text-red-400">{tasks.filter(t => t.status === 'failed').length}</span></div>
          </div>
        </div>
        <div className="flex gap-4">
          <button className="bg-emerald-700 text-white px-4 py-2 rounded shadow hover:bg-emerald-600" onClick={forceSync}>Force Sync</button>
          <button className="bg-blue-700 text-white px-4 py-2 rounded shadow hover:bg-blue-600" onClick={dispatchTestTask}>Dispatch Test Task</button>
        </div>
      </div>
    </div>
  );
}

export default CoordinatorControlRoom;
