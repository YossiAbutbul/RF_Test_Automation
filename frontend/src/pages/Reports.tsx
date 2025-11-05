import { PageHeader, Card } from '@/shared/components/ui';

export default function Reports() {
  const rows = [
    { status: 'Passed', name: 'Full Protocol Test - Device 001', device: 'Sonata 2 IL', date: 'Jan 27, 03:30 PM', duration: '12m 34s', passed: '10/10', protocols: ['LoRa', 'BLE'] },
    { status: 'Partial', name: 'LTE Compliance Verification', device: 'RF Module v2.1', date: 'Jan 27, 02:15 PM', duration: '18m 42s', passed: '6/8', protocols: ['LTE'] },
    { status: 'Failed', name: 'Power Consumption Analysis', device: 'Sonata 2 IL', date: 'Jan 27, 01:45 PM', duration: '8m 21s', passed: '3/5', protocols: ['BLE'] },
  ]

  return (
    <div>
      <PageHeader title="Reports" subtitle="View detailed analytics and test reports" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Total Reports</div>
          <div className="text-3xl font-semibold mt-1">6</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Pass Rate</div>
          <div className="text-3xl font-semibold mt-1 text-emerald-600">50.0%</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Passed Tests</div>
          <div className="text-3xl font-semibold mt-1">3</div>
        </Card>
      </div>

      <Card className="p-4 mb-3">
        <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-3">
          <select className="rounded-xl border px-3 py-2 bg-white">
            <option>All Projects</option>
          </select>
          <input className="rounded-xl border px-3 py-2 bg-white" placeholder="Search by report name or device..." />
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="text-left text-zinc-500">
              <th className="py-2 px-4">Status</th>
              <th className="py-2 px-4">Report Name</th>
              <th className="py-2 px-4">Device Type</th>
              <th className="py-2 px-4">Date</th>
              <th className="py-2 px-4">Tests Passed</th>
              <th className="py-2 px-4">Protocols</th>
              <th className="py-2 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-zinc-200">
                <td className="py-2 px-4">
                  {r.status === 'Passed' ? (
                    <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-emerald-50 text-emerald-600">
                      Passed
                    </span>
                  ) : r.status === 'Failed' ? (
                    <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-rose-50 text-rose-600">
                      Failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-[#EEF0FF] text-[#5964DA]">
                      Partial
                    </span>
                  )}
                </td>
                <td className="py-2 px-4">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-zinc-500">production • full-test</div>
                </td>
                <td className="py-2 px-4">{r.device}</td>
                <td className="py-2 px-4">
                  {r.date}
                  <div className="text-xs text-zinc-400">{r.duration}</div>
                </td>
                <td className="py-2 px-4">{r.passed}</td>
                <td className="py-2 px-4">
                  <div className="flex gap-2">
                    {r.protocols.map((p) => (
                      <span key={p} className={`inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium ${p === 'LoRa' ? 'bg-[#EEF0FF] text-[#5964DA]' : 'bg-zinc-100 text-zinc-700'}`}>
                        {p}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 px-4">
                  <div className="flex gap-3">
                    <button className="underline">Open</button>
                    <button className="underline">Export</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
