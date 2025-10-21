import React, { useMemo, useState } from 'react'
import { Gauge, Settings, CirclePlay, NotebookPen, Activity, FileText } from 'lucide-react'

import Dashboard from '@/pages/Dashboard'
import Configurations from '@/pages/Configurations'
import TestSequence from '@/pages/TestSequence'
import TestMatrix from '@/pages/TestMatrix'
import SpectrumView from '@/pages/SpectrumView'
import Reports from '@/pages/Reports'
// import Card removed: the sidebar no longer uses Card

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
        className="fixed inset-y-0 left-0 bg-gradient-to-br from-[#EEF0FF] via-[#F7F9FF] to-white border-r border-zinc-200 shadow-lg overflow-hidden"
        style={{ width: sbWidth, transition }}
        aria-label="Sidebar"
      >
        <div className="h-full p-4 flex flex-col">
          {/* Application title moved from header to sidebar; clicking toggles collapse */}
          <div
            className="mb-6 cursor-pointer select-none"
            onClick={() => setOpen(s => !s)}
          >
            {open ? (
              <div className="flex items-baseline">
                <span className="text-xl font-semibold text-[#5964DA]">
                  RF Automation
                </span>
               
              </div>
            ) : (
              <span className="text-xl font-bold text-[#5964DA]">RF</span>
            )}
          </div>
          {/* Nav container without card */}
          <div className="flex-1 overflow-auto">
            <nav className="flex flex-col gap-2">
              {NAV.map(item => {
                const Icon = item.icon
                const isActive = active === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => setActive(item.key)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-left transition-colors
                      ${
                        isActive
                          ? 'bg-gradient-to-r from-[#5964DA] to-[#8892E6] text-white font-medium'
                          : 'text-zinc-700 hover:bg-zinc-100'
                      }`}
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
          </div>
        </div>
      </aside>

      {/* Header shifts with sidebar; full-width across page */}
      {/* <header
        className="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-zinc-200"
        style={{ marginLeft: sbWidth, transition }}
      > */}
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center">
          </div>
          {/* <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-emerald-50 text-emerald-600">DUT</span>
            <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium bg-[#EEF0FF] text-[#5964DA]">Analyzer</span>
          </div> */}
        </div>
      {/* </header> */}

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
