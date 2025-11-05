// frontend/src/shared/components/ui/Badge/index.tsx
import React from 'react';

export type BadgeTone = 'green' | 'red' | 'zinc' | 'blue' | 'purple';

const toneClassMap: Record<BadgeTone, string> = {
  green: 'badge badge-green',
  red: 'badge badge-red',
  zinc: 'badge badge-zinc',
  blue: 'badge badge-blue',
  purple: 'badge bg-violet-50 text-violet-600',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ tone = 'zinc', children }) => (
  <span className={toneClassMap[tone]}>{children}</span>
);

export default Badge;