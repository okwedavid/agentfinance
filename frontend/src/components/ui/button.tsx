import React from 'react';

export function Button({ children, className = '', onClick, ...props }: any) {
  return (
    <button onClick={onClick} className={`px-4 py-2 rounded ${className}`} {...props}>
      {children}
    </button>
  );
}

export default Button;
