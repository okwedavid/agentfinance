"use client";
export default function LoadingSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse space-y-4 ${className}`}>
      <div className="h-8 bg-white/10 rounded w-1/3" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-40 bg-white/5 rounded" />
        <div className="h-40 bg-white/5 rounded" />
        <div className="h-40 bg-white/5 rounded" />
      </div>
    </div>
  );
}
