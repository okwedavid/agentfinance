import React from "react";
import clsx from "clsx";

interface MetricCardProps {
  title: string;
  value: number | string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  icon,
  badge,
  className,
}) => (
  <div
    className={clsx(
      "rounded-2xl shadow-md bg-gradient-to-br from-gray-900 to-gray-800 dark:from-gray-800 dark:to-gray-900 p-6 flex flex-col gap-2 items-start hover:shadow-lg transition-all duration-200",
      className
    )}
  >
    <div className="flex items-center gap-2 w-full justify-between">
      <span className="text-lg font-semibold text-gray-300 dark:text-gray-100">{title}</span>
      {icon}
      {badge}
    </div>
    <div className="text-3xl font-bold text-white dark:text-gray-200 mt-2">{value}</div>
  </div>
);

export default MetricCard;
