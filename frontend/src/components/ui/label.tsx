import React from 'react';

export function Label({ children, htmlFor, className = '' }: any) {
  return (
    <label htmlFor={htmlFor} className={`block text-sm font-medium text-blue-200 mb-1 ${className}`}>
      {children}
    </label>
  );
}

export default Label;
