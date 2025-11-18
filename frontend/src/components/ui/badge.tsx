import React from 'react';

export function Badge({ children, className = '', variant = 'default', ...props }: any) {
  const base = 'px-2 py-1 rounded text-sm';
  return (
    <span className={`${base} ${className}`} {...props}>
      {children}
    </span>
  );
}

export default Badge;
