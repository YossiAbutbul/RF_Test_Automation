import { PageHeader, Card } from '@/shared/components/ui';
import { Wifi, Radio } from 'lucide-react'

export default function Dashboard() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Monitor your RF testing operations and device performance"
      />

      {/* Connected Devices */}
      <div className="mb-6">
        <div className="text-base font-medium">Connected Devices</div>
        <div className="text-sm text-zinc-500 mb-3">Monitor and control your test equipment</div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Spectrum Analyzer */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full"
                  style={{ background: 'linear-gradient(180deg, #EEF0FF 0%, #FFFFFF 100%)', color: '#5964DA' }}
                >
                  <Radio className="w-4 h-4" />
                </span>
                <span>Spectrum Analyzer</span>
              </div>
              <span className="rounded-full px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-600">
                Connected
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-zinc-500">IP Address</div>
                <div className="mt-1 font-medium tracking-tight text-zinc-700">172.16.10.1</div>
              </div>
              <div>{/* spacer to match layout */}</div>
            </div>
          </Card>

          {/* DUT (BLE) */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full"
                  style={{ background: 'linear-gradient(180deg, #EEF0FF 0%, #FFFFFF 100%)', color: '#5964DA' }}
                >
                  <Wifi className="w-4 h-4" />
                </span>
                <span>DUT (BLE)</span>
              </div>
              <span className="rounded-full px-3 py-1 text-xs font-medium bg-rose-50 text-rose-600">
                ● Connect
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-zinc-500">Device Name</div>
                <div className="mt-1 font-medium tracking-tight text-zinc-700">RF_Device_001</div>
              </div>
              <div>
                <div className="text-zinc-500">MAC Address</div>
                <div className="mt-1 font-medium tracking-tight text-zinc-700">AA:BB:CC:DD:EE:FF</div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Test Summary */}
      <div className="mb-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-base font-medium">Test Summary</div>
            <div className="text-sm text-zinc-500">Overview of testing performance</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-500">Pass Rate</div>
            <div className="text-emerald-600 font-semibold">96.1%</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          <Card className="p-4">
            <div className="text-xs text-zinc-500 mb-2">Total Tests</div>
            <div className="text-3xl font-semibold tracking-tight">1,247</div>
            <div className="text-xs text-zinc-400">All time</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-zinc-500 mb-2">Passed Tests</div>
            <div className="text-3xl font-semibold tracking-tight text-emerald-600">1,198</div>
            <div className="text-xs text-zinc-400">Success rate</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-zinc-500 mb-2">Failed Tests</div>
            <div className="text-3xl font-semibold tracking-tight text-rose-600">49</div>
            <div className="text-xs text-zinc-400">Needs attention</div>
          </Card>
        </div>
      </div>

      {/* Recent Tests */}
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-base font-medium">Recent Tests</div>
          <div className="text-sm text-zinc-500">Latest test executions and results</div>
        </div>
        <button className="rounded-xl border px-3 py-1.5 text-sm">View All</button>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
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
              {[
                { name: 'BLE Connection Stability', device: 'RF_Device_001', pass: true, dur: '2m 34s', date: '2025-01-27 14:30' },
                { name: 'Frequency Response Test', device: 'RF_Device_002', pass: false, dur: '4m 12s', date: '2025-01-27 14:15' },
                { name: 'Power Consumption Analysis', device: 'RF_Device_001', pass: true, dur: '3m 45s', date: '2025-01-27 13:45' },
                { name: 'Signal Strength Measurement', device: 'RF_Device_003', pass: true, dur: '1m 58s', date: '2025-01-27 13:20' },
              ].map((r) => (
                <tr key={r.name} className="border-t border-zinc-200">
                  <td className="py-3 px-4 font-medium text-zinc-700">{r.name}</td>
                  <td className="py-3 px-4">{r.device}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium ${
                        r.pass ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                      }`}
                    >
                      {r.pass ? 'Passed' : 'Failed'}
                    </span>
                  </td>
                  <td className="py-3 px-4">{r.dur}</td>
                  <td className="py-3 px-4">{r.date}</td>
                  <td className="py-3 px-4">
                    <button className="underline">Report</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
