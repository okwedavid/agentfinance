import React, { useMemo } from 'react';
import useWebSocket from '../hooks/useWebSocket';
import { useAuth } from '../context/AuthContext';

const LogFeed: React.FC = () => {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? (document.cookie.match(/token=([^;]+)/)?.[1] || '') : '';
  const { parsedMessages } = useWebSocket(process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5000', token);

  // Show last 50 events
  const logs = useMemo(() => parsedMessages.slice(-50).reverse(), [parsedMessages]);

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl p-6">
      <h2 className="text-xl font-bold text-white mb-4">Live Event Log</h2>
      <div className="h-64 overflow-y-auto text-xs text-gray-200">
        {logs.map((log, i) => (
          <pre key={i} className="mb-1 whitespace-pre-wrap">{typeof log === 'string' ? log : JSON.stringify(log, null, 2)}</pre>
        ))}
      </div>
    </div>
  );
};

export default LogFeed;
