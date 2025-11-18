import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  CartesianGrid,
} from "recharts";

interface RealtimeLineChartProps {
  data: Array<{ time: string; value: number }>;
  metric: string;
  live: boolean;
}

export const RealtimeLineChart: React.FC<RealtimeLineChartProps> = ({ data, metric, live }) => {
  const color = live ? "#34d399" : "#f59e42";
  return (
    <div className="bg-gray-900 dark:bg-gray-800 rounded-2xl shadow-md p-4 relative">
      <span className={
        `absolute top-4 right-4 text-xs font-semibold px-2 py-1 rounded bg-${live ? "emerald" : "yellow"}-600 text-white animate-pulse`
      }>
        {live ? "Live" : "Polling"}
      </span>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis dataKey="time" tick={{ fill: "#d1d5db", fontSize: 12 }} />
          <YAxis tick={{ fill: "#d1d5db", fontSize: 12 }} />
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <Tooltip wrapperClassName="!bg-gray-800 !text-white !rounded-lg !shadow-lg" />
          <Area type="monotone" dataKey="value" stroke={color} fillOpacity={1} fill="url(#colorValue)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RealtimeLineChart;
