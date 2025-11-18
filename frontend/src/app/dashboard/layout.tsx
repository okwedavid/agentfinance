import React from "react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-gray-900 dark:from-gray-900 dark:to-gray-950">
      {children}
    </div>
  );
}
