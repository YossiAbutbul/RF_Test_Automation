// frontend/src/shared/components/ui/SectionTitle/index.tsx
import React from 'react';

export interface SectionTitleProps {
  children: React.ReactNode;
}

export const SectionTitle: React.FC<SectionTitleProps> = ({ children }) => (
  <h2 className="section-title mb-3">{children}</h2>
);

export default SectionTitle;