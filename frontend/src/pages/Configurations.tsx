import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'

export default function Configurations() {
  return (
    <div>
      <PageHeader title="Configurations" subtitle="Manage your test parameters and device settings" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <div className="text-base font-medium">DUT Connection</div>
          <div className="text-sm text-zinc-500">Connect to Device Under Test</div>

          <div className="mt-4 h-48 rounded-xl border border-dashed grid place-items-center text-sm text-zinc-500">
            Devices table placeholder
          </div>

          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="text-rose-600 inline-flex items-center gap-2">
              <span className="text-lg">●</span> Disconnected
            </div>
            <button className="px-4 py-2 rounded-xl bg-[#6B77F7] text-white">Connect</button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-base font-medium">Analyzer Connection</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
            <div>
              <label className="text-xs text-zinc-500">IP Address</label>
              <input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" defaultValue="172.16.10.1" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Port</label>
              <input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" defaultValue="5555" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Model</label>
              <div className="w-full mt-1 rounded-xl border px-3 py-2 bg-white">Keysight N9020A</div>
            </div>
            <div>
              <label className="text-xs text-zinc-500">Status</label>
              <div className="mt-1">
                <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-emerald-50 text-emerald-600">
                  Connected
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button className="px-3 py-2 rounded-xl bg-emerald-500 text-white">Disconnect</button>
          </div>
        </Card>
      </div>
    </div>
  )
}
