import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const HealthWidget: React.FC = () => {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const fetchHealth = async () => {
      try {
        await apiFetch('/health');
        setHealthy(true);
      } catch {
        setHealthy(false);
      }
      setBlink(true);
      setTimeout(() => setBlink(false), 400);
    };
    fetchHealth();
    interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  let color = healthy === null ? 'bg-gray-400' : healthy ? 'bg-green-500' : 'bg-red-500';
  let label = healthy === null ? 'Checking...' : healthy ? 'Healthy' : 'Error';

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl shadow-xl bg-gray-900 text-white text-sm font-semibold ${blink ? 'ring-2 ring-offset-2 ring-green-400' : ''}`}>
        <span className={`w-3 h-3 rounded-full animate-pulse ${color}`}></span>
        {label}
      </div>
    </div>
  );
};

export default HealthWidget;
