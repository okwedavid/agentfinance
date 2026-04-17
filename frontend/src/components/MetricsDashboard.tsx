"use client";
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export default function MetricsDashboard() {
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/analytics/summary');
        setMetrics(await res.json());
      } catch (e) { console.error(e); }
    }
    load();
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <motion.div className="backdrop-blur bg-white/5 p-6 rounded-lg" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="text-sm text-gray-300">Total Tasks</div>
        <div className="text-2xl font-bold">{metrics?.totalTasks ?? 0}</div>
      </motion.div>
      <motion.div className="backdrop-blur bg-white/5 p-6 rounded-lg" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="text-sm text-gray-300">Agents</div>
        <div className="text-2xl font-bold">{metrics?.perAgent?.length ?? 0}</div>
      </motion.div>
      <motion.div className="backdrop-blur bg-white/5 p-6 rounded-lg" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="text-sm text-gray-300">Avg Success</div>
        <div className="text-2xl font-bold">{Math.round((metrics?.perAgent?.reduce((s:any,a:any)=>s+(a.successRate||0),0) || 0) / (metrics?.perAgent?.length||1))}%</div>
      </motion.div>
    </div>
  );
}
