import React from 'react'
import { Card } from "@/shared/components/ui/Card";
import { MoreVertical, Plus } from 'lucide-react'

const TESTS = [
  {key:'tx-power', name:'TX Power'},
  {key:'freq-accuracy', name:'Frequency Accuracy'},
  {key:'obw', name:'OBW'},
  {key:'tx-current', name:'TX Current Consumption'},
  {key:'spurious', name:'Spurious Emissions'},
]

export default function AvailableTestsPanel(){
  return (
    <Card className='p-4 w-full'>
      <div className='flex items-center justify-between mb-2'>
        <div className='font-medium'>Available Tests</div>
        <button className='text-sm inline-flex items-center gap-1 px-2 py-1 rounded-lg border'>
          <Plus className='w-4 h-4'/> Add
        </button>
      </div>

      <div className='subtle mb-3'>Drag tests to the LORA procedure builder</div>

      <div className='space-y-3 overflow-y-auto max-h-[60vh] pr-1'>
        {TESTS.map(t=> (
          <div key={t.key} className='rounded-xl border px-3 py-3 bg-white hover:bg-zinc-50 flex items-center justify-between'>
            <div>
              <div className='font-medium'>{t.name}</div>
              <div className='text-xs text-zinc-500'>Drag to add</div>
            </div>
            <button className='p-1 rounded hover:bg-zinc-100'>
              <MoreVertical className='w-4 h-4'/>
            </button>
          </div>
        ))}
      </div>

      <div className='mt-4'>
        <div className='text-sm font-medium mb-2'>Quick Actions</div>
        <div className='grid gap-2'>
          <button className='rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2'>Load Template</button>
          <button className='rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2'>Save as Template</button>
        </div>
      </div>
    </Card>
  )
}
