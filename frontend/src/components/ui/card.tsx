import React from 'react';

export function Card({ children, className = '' }: any) {
  return <div className={className}>{children}</div>;
}

export function CardHeader({ children, className = '' }: any) {
  return <div className={className}>{children}</div>;
}

export function CardTitle({ children, className = '' }: any) {
  return <h3 className={className}>{children}</h3>;
}

export function CardContent({ children, className = '' }: any) {
  return <div className={className}>{children}</div>;
}

export default Card;
