import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { MoreVertical, Plus } from 'lucide-react'
import { useState } from 'react'

export default function TestSequence() {
  const [tab, setTab] = useState<'LoRa' | 'LTE' | 'BLE'>('LoRa')
  const TESTS = ['TX Power', 'Frequency Accuracy', 'OBW', 'TX Current Consumption', 'Spurious Emissions']

  return (
    <div>
      <PageHeader title="Test Sequence" subtitle="Define and control your automated test workflows" />

      <div className="flex items-center gap-4 text-sm mb-3">
        {(['LoRa', 'LTE', 'BLE'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 rounded-lg border ${tab === t ? 'bg-white shadow' : 'bg-zinc-50 border-transparent'}`}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto text-sm text-zinc-500">Total Tests: 0</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">LORA Test Procedure Builder</div>
              <div className="text-sm text-zinc-500">Drag tests from the library or reorder existing tests</div>
            </div>
            <div className="flex gap-2">
              <button className="rounded-xl border px-3 py-2 text-sm">Load LORA</button>
              <button className="rounded-xl bg-[#6B77F7] text-white px-3 py-2 text-sm">Save LORA</button>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-dashed bg-zinc-50 min-h-[220px] grid place-items-center text-sm text-zinc-500">
            No LORA tests added yet
            <br />
            Drag tests from the library to get started
          </div>
        </Card>

        <Card className="p-4 w-full">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Available Tests</div>
            <button className="text-sm inline-flex items-center gap-1 px-2 py-1 rounded-lg border">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          <div className="text-sm text-zinc-500 mb-3">Drag tests to the LORA procedure builder</div>

          <div className="space-y-3 overflow-y-auto max-h-[60vh] pr-1">
            {TESTS.map((name) => (
              <div
                key={name}
                className="rounded-xl border px-3 py-3 bg-white hover:bg-zinc-50 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">{name}</div>
                  <div className="text-xs text-zinc-500">Drag to add</div>
                </div>
                <button className="p-1 rounded hover:bg-zinc-100">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium mb-2">Quick Actions</div>
            <div className="grid gap-2">
              <button className="rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2">Load Template</button>
              <button className="rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2">Save as Template</button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
