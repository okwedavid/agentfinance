import React from "react";
export default function LiveFeed({ events }: { events: any[] }) {
  return (
    <div className="bg-gray-900 rounded-2xl p-6 shadow h-full">
      <h2 className="text-lg font-semibold text-white mb-2">Live Events Feed</h2>
      <div className="h-64 overflow-y-auto text-xs text-gray-200">
        {events.slice(-50).reverse().map((ev, i) => (
          <pre key={i} className="mb-1 whitespace-pre-wrap">{typeof ev === 'string' ? ev : JSON.stringify(ev, null, 2)}</pre>
        ))}
      </div>
    </div>
  );
}
