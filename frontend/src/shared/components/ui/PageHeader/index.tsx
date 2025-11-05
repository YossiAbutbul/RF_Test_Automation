// frontend/src/shared/components/ui/PageHeader/index.tsx
import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle }) => (
  <div className="mb-6">
    <h1 className="text-2xl font-bold text-zinc-900">{title}</h1>
    {subtitle && <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>}
  </div>
);

export default PageHeader;