"use client";
import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

export function AnalyticsChart({ series }: { series: any[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="p-4 bg-white rounded shadow">
        <h3 className="font-semibold mb-2">Tasks Over Time</h3>
        <LineChart width={500} height={250} data={series}>
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="count" stroke="#8884d8" />
        </LineChart>
      </div>
      <div className="p-4 bg-white rounded shadow">
        <h3 className="font-semibold mb-2">Success Rate Comparison</h3>
        <BarChart width={500} height={250} data={series.map(s=>({ name: s.agent || s.date, value: s.successRate || 0 }))}>
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="value" fill="#82ca9d" />
        </BarChart>
      </div>
      <div className="p-4 bg-white rounded shadow col-span-full">
        <h3 className="font-semibold mb-2">Status Distribution</h3>
        <PieChart width={400} height={200}>
          <Pie dataKey="value" data={[{ name: 'ok', value: 400 }, { name: 'fail', value: 100 }]} cx={200} cy={100} outerRadius={80} label>
            <Cell fill="#8884d8" />
            <Cell fill="#82ca9d" />
          </Pie>
          <Tooltip />
        </PieChart>
      </div>
    </div>
  );
}

export default AnalyticsChart;
