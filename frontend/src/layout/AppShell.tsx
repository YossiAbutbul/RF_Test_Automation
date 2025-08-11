import React, { useMemo, useState } from 'react'
import { Gauge, Settings, CirclePlay, NotebookPen, Activity, FileText, Menu } from 'lucide-react'
import Dashboard from '@/pages/Dashboard'
import Configurations from '@/pages/Configurations'
import TestSequence from '@/pages/TestSequence'
import TestMatrix from '@/pages/TestMatrix'
import SpectrumView from '@/pages/SpectrumView'
import Reports from '@/pages/Reports'
import { Badge } from '@/components/ui/Badge'
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
  const [active, setActive] = useState<NavKey>('sequence')
  const ActiveComp = useMemo(()=> NAV.find(n=>n.key===active)?.comp ?? Dashboard, [active])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 backdrop-blur bg-white/80 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-900">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={()=>setOpen(s=>!s)} className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"><Menu className="w-5 h-5"/></button>
            <div className="font-semibold">RF Automation <span className='text-zinc-400 font-normal text-sm ml-2'>Test Platform</span></div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Badge tone="green">DUT</Badge>
            <Badge tone="blue">Analyzer</Badge>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-6">
        <aside className={`transition-all ${open?'w-64 opacity-100':'w-0 opacity-0 lg:w-16'} overflow-hidden`}>
          <Card className="p-2 h-full">
            <nav className="flex flex-col">
              {NAV.map(item=>{
                const Icon = item.icon
                const isActive = active===item.key
                return (
                  <button key={item.key} onClick={()=>setActive(item.key)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${isActive?'bg-zinc-100 dark:bg-zinc-800 font-medium':''}`}>
                    <Icon className="w-4 h-4"/>
                    <span className={`${open?'block':'hidden lg:block'}`}>{item.label}</span>
                  </button>
                )
              })}
            </nav>
          </Card>
        </aside>
        <main>
          <ActiveComp />
        </main>
      </div>
    </div>
  )
}
