// frontend/src/shared/components/ui/Card/index.tsx
import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ children, className }) => (
  <div className={`card ${className || ''}`}>{children}</div>
);

export default Card;