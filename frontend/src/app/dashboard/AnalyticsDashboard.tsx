"use client";
import React, { useContext, useEffect, useState, useRef } from "react";
import { apiFetch } from '../../lib/api';
import MetricCard from "./components/MetricCard";
import RealtimeLineChart from "./components/RealtimeLineChart";
import AgentPerformancePanel from "./components/AgentPerformancePanel";
import DashboardLayout from "./DashboardLayout";
import useWebSocket from "../../hooks/useWebSocket";
import AnalyticsHistoryPanel from './AnalyticsHistoryPanel';
//import { WebSocketContext } from "../../context/WebSocketContext";

const METRIC_TYPES = [
  { key: "tasksProcessed", label: "Tasks/sec" },
  { key: "avgLatency", label: "Avg Latency (ms)" },
  { key: "agentsOnline", label: "Agents Online" },
  { key: "queueSize", label: "Queue Size" },
];

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

const POLL_INTERVAL = 2000;

const AnalyticsDashboard: React.FC = () => {
  const { parsedMessages, connectionStatus } = useWebSocket(process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001");
  const [metrics, setMetrics] = useState({
    agentsOnline: 0,
    tasksProcessed: 0,
    queueSize: 0,
    avgLatency: 0,
  });
  const [chartData, setChartData] = useState<Array<{ time: string; value: number }>>([]);
  const [metricType, setMetricType] = useState("tasksProcessed");
  const [live, setLive] = useState(false);
  const [agents, setAgents] = useState<Array<{ id: string; status: "online" | "offline"; tasksHandled: number; uptime: number }>>([]);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // WebSocket event handling
  useEffect(() => {
    setLive(connectionStatus === "connected");
    if (parsedMessages.length === 0) return;
    const lastMsg = parsedMessages[parsedMessages.length - 1];
    if (lastMsg.type === "metrics:update") {
      setMetrics(lastMsg.payload);
      setChartData((prev) => {
        const arr = [
          ...prev,
          { time: formatTime(Date.now()), value: lastMsg.payload[metricType] },
        ];
        return arr.slice(-20);
      });
    }
    if (lastMsg.type === "agent:update") {
      setAgents(lastMsg.payload);
    }
  }, [parsedMessages, metricType, connectionStatus]);

  // Fallback polling
  useEffect(() => {
    if (live) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const data = await apiFetch('/metrics');
        setMetrics(data);
        setChartData((prev) => {
          const arr = [
            ...prev,
            { time: formatTime(Date.now()), value: data[metricType] },
          ];
          return arr.slice(-20);
        });
      } catch (e) {
        // Optionally handle error
      }
    }, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [live, metricType]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-gray-900 dark:from-gray-900 dark:to-gray-950">
      <div className="py-8">
        <div className="flex items-center justify-between mb-6 px-6">
          <h1 className="text-3xl font-bold text-white">Analytics Dashboard</h1>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-xs font-semibold ${live ? "bg-emerald-600 animate-pulse" : "bg-yellow-600"} text-white`}>{live ? "Live" : "Polling"}</span>
            <select
              className="bg-gray-800 text-white rounded px-2 py-1 text-xs border border-gray-700 focus:outline-none"
              value={metricType}
              onChange={(e) => setMetricType(e.target.value)}
            >
              {METRIC_TYPES.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
        <DashboardLayout>
          <MetricCard title="Agents Online" value={metrics.agentsOnline} />
          <MetricCard title="Tasks Processed" value={metrics.tasksProcessed} />
          <MetricCard title="Queue Size" value={metrics.queueSize} />
          <MetricCard title="Avg Latency (ms)" value={metrics.avgLatency} />
          <RealtimeLineChart data={chartData} metric={metricType} live={live} />
          <AgentPerformancePanel agents={agents} />
        </DashboardLayout>
        <AnalyticsHistoryPanel />
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
