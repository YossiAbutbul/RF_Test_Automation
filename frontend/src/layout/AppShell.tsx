import React, { useMemo, useState } from 'react'
import { Gauge, Settings, CirclePlay, NotebookPen, Activity, FileText, Menu } from 'lucide-react'

import Dashboard from '@/pages/Dashboard'
import Configurations from '@/pages/Configurations'
import TestSequence from '@/pages/TestSequence'
import TestMatrix from '@/pages/TestMatrix'
import SpectrumView from '@/pages/SpectrumView'
import Reports from '@/pages/Reports'
import { Card } from '@/components/ui/Card'

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: Gauge, comp: Dashboard },
  { key: 'config', label: 'Configurations', icon: Settings, comp: Configurations },
  { key: 'sequence', label: 'Test Sequence', icon: CirclePlay, comp: TestSequence },
  { key: 'matrix', label: 'Test Matrix', icon: NotebookPen, comp: TestMatrix },
  { key: 'spectrum', label: 'Spectrum View', icon: Activity, comp: SpectrumView },
  { key: 'reports', label: 'Reports', icon: FileText, comp: Reports },
] as const
type NavKey = typeof NAV[number]['key']

export default function AppShell() {
  const [open, setOpen] = useState(true)
  const [active, setActive] = useState<NavKey>('dashboard')
  const ActiveComp = useMemo(() => NAV.find(n => n.key === active)?.comp ?? Dashboard, [active])

  // Fixed sizes (px) and a single source of truth for layout shift
  const SB_OPEN = 256  // 16rem
  const SB_COLLAPSED = 72 // 4.5rem
  const sbWidth = open ? SB_OPEN : SB_COLLAPSED
  const transition = 'width .22s ease, margin-left .22s ease'

  return (
    <div className="min-h-screen">
      {/* Fixed, full-height light sidebar */}
      <aside
        className="fixed inset-y-0 left-0 bg-white border-r border-zinc-200 shadow-sm overflow-hidden"
        style={{ width: sbWidth, transition }}
        aria-label="Sidebar"
      >
        <div className="h-full p-2">
          <Card className="p-2 h-full">
            <nav className="flex flex-col">
              {NAV.map(item => {
                const Icon = item.icon
                const isActive = active === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => setActive(item.key)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-left transition-colors
                      ${isActive ? 'bg-zinc-100 text-[#5964DA] font-medium' : 'text-zinc-700 hover:bg-zinc-100'}`}
                  >
                    <Icon className="w-4 h-4" />
                    {/* fade/slide label when collapsing */}
                    <span
                      style={{
                        transition: 'opacity .18s ease',
                        opacity: open ? 1 : 0,
                      }}
                      className={`whitespace-nowrap ${open ? 'block' : 'hidden'}`}
                    >
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </nav>
          </Card>
        </div>
      </aside>

      {/* Header shifts with sidebar; full-width across page */}
      <header
        className="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-zinc-200"
        style={{ marginLeft: sbWidth, transition }}
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOpen(s => !s)}
              aria-expanded={open}
              className="p-2 rounded-xl hover:bg-zinc-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="font-semibold">
              RF Automation <span className="text-zinc-400 font-normal text-sm ml-2">Test Platform</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-emerald-50 text-emerald-600">DUT</span>
            <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-[#EEF0FF] text-[#5964DA]">Analyzer</span>
          </div>
        </div>
      </header>

      {/* Main content also shifts with sidebar */}
      <main
        style={{ marginLeft: sbWidth, transition }}
        className="px-4 py-6"
      >
        <div className="max-w-7xl mx-auto">
          <ActiveComp />
        </div>
      </main>
    </div>
  )
}
