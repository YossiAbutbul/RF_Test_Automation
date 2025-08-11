// src/components/dashboard/StatCard.tsx
export default function StatCard({
  title, value, accentClass = '', sub = '',
}: { title: string; value: string; accentClass?: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-title">{title}</div>
      <div className={`kpi-value ${accentClass}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}
