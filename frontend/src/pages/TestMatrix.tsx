import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { useState } from 'react'

export default function TestMatrix() {
  const [tab, setTab] = useState<'LoRa' | 'LTE' | 'BLE'>('LoRa')

  const rows = [
    { status: 'Passed', name: 'TX Power', value: '14.20 dBm', low: '13.5 dBm', high: '14.5 dBm', result: 'Pass' },
    { status: 'Passed', name: 'Frequency Accuracy', value: '868.00 MHz', low: '867.9 MHz', high: '868.1 MHz', result: 'Pass' },
    { status: 'Failed', name: 'Spurious Emissions', value: '-35.20 dBm', low: '-40 dBm', high: '-30 dBm', result: 'Fail' },
    { status: 'Not Started', name: 'OBW', value: '-', low: '0 kHz', high: '125 kHz', result: '-' },
  ]

  return (
    <div>
      <PageHeader title="Test Matrix" subtitle="Configure comprehensive testing coverage matrices" />

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500">Select Project</label>
            <select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white">
              <option>IoT Sensor Array Project</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Select DUT (MAC Address)</label>
            <select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white">
              <option>AA:BB:CC:DD:EE:FF (RF_Device_001)</option>
            </select>
          </div>
        </div>
        <div className="mt-3 text-sm text-zinc-500">
          Current Configuration • Project: IoT Sensor Array Project • Device: AA:BB:CC:DD:EE:FF
        </div>
      </Card>

      <div className="flex items-center gap-4 text-sm my-3">
        {(['LoRa', 'LTE', 'BLE'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 rounded-lg border ${tab === t ? 'bg-white shadow' : 'bg-zinc-50 border-transparent'}`}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button className="rounded-xl border px-3 py-2 text-sm">Load Matrix</button>
          <button className="rounded-xl border px-3 py-2 text-sm">Save Matrix</button>
          <button className="rounded-xl bg-[#6B77F7] text-white px-3 py-2 text-sm">Run Tests</button>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 text-sm text-zinc-600">
          LoRa Test Execution • <span className="text-zinc-400">Test results for LoRa protocol</span>
          <span className="float-right text-zinc-500">Tests: 2/3 passed</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="text-left text-zinc-500">
              <th className="py-2 px-4">Status</th>
              <th className="py-2 px-4">Test Name</th>
              <th className="py-2 px-4">Measured Value</th>
              <th className="py-2 px-4">Low Limit</th>
              <th className="py-2 px-4">High Limit</th>
              <th className="py-2 px-4">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-top border-zinc-200 border-t">
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
                    <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-zinc-100 text-zinc-700">
                      Not Started
                    </span>
                  )}
                </td>
                <td className="py-2 px-4">{r.name}</td>
                <td className="py-2 px-4">{r.value}</td>
                <td className="py-2 px-4">{r.low}</td>
                <td className="py-2 px-4">{r.high}</td>
                <td className="py-2 px-4">
                  {r.result === 'Pass' ? (
                    <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-emerald-50 text-emerald-600">
                      Pass
                    </span>
                  ) : r.result === 'Fail' ? (
                    <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-rose-50 text-rose-600">
                      Fail
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
