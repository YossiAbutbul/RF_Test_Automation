import React from 'react'
import { Wifi, Radio } from 'lucide-react'
import { Card } from "@/shared/components/ui/Card";

type Props = {
  title: 'Spectrum Analyzer' | 'DUT (BLE)'
  rightBadge?: React.ReactNode
  lines: { label: string; value?: string }[]
  kind: 'analyzer' | 'dut'
}

export default function DeviceCard({ title, rightBadge, lines, kind }: Props) {
  const Icon = kind === 'analyzer' ? Radio : Wifi
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-full"
            style={{ background: 'linear-gradient(180deg, #EEF0FF 0%, #FFFFFF 100%)', color: '#5964DA' }}
          >
            <Icon className="w-4 h-4" />
          </span>
          <span>{title}</span>
        </div>
        {rightBadge}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        {lines.map((l) => (
          <div key={l.label}>
            <div className="text-zinc-500">{l.label}</div>
            <div className="mt-1 font-medium tracking-tight text-zinc-700">{l.value ?? ''}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
