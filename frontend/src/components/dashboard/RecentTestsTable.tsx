// src/components/dashboard/RecentTestsTable.tsx
import { Card } from '@/components/ui/Card'

type Row = {
  name: string
  device: string
  pass: boolean
  dur: string
  date: string
}

const ROWS: Row[] = [
  { name:'BLE Connection Stability', device:'RF_Device_001', pass:true,  dur:'2m 34s', date:'2025-01-27 14:30' },
  { name:'Frequency Response Test',  device:'RF_Device_002', pass:false, dur:'4m 12s', date:'2025-01-27 14:15' },
  { name:'Power Consumption Analysis', device:'RF_Device_001', pass:true, dur:'3m 45s', date:'2025-01-27 13:45' },
  { name:'Signal Strength Measurement', device:'RF_Device_003', pass:true, dur:'1m 58s', date:'2025-01-27 13:20' },
]

export default function RecentTestsTable() {
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="section-head">Recent Tests</div>
          <div className="section-sub">Latest test executions and results</div>
        </div>
        <button className="rounded-xl border px-3 py-1.5 text-sm">View All</button>
      </div>

      <Card className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900/40">
              <tr className="text-left text-zinc-500">
                <th className="py-3 px-4">Test Name</th>
                <th className="py-3 px-4">Device</th>
                <th className="py-3 px-4">Result</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.name} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-3 px-4 font-medium text-zinc-700">{r.name}</td>
                  <td className="py-3 px-4">{r.device}</td>
                  <td className="py-3 px-4">
                    <span className={`pill ${r.pass ? 'pill-green' : 'pill-red'}`}>
                      {r.pass ? 'Passed' : 'Failed'}
                    </span>
                  </td>
                  <td className="py-3 px-4">{r.dur}</td>
                  <td className="py-3 px-4">{r.date}</td>
                  <td className="py-3 px-4"><button className="underline">Report</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
